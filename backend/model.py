
from transformers import AutoModelForCausalLM, AutoTokenizer

from typing import Any, List



from langchain_core.language_models.llms import LLM
from pydantic import BaseModel
from typing import Optional, List
from utils import extract_chunks,chunk_to_document,build_context,retrieve_documents
import json
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from glob import glob
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import re


class HFLocalLLM(LLM, BaseModel):
    model: any
    tokenizer: any

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, model, tokenizer, **data):
        super().__init__(model=model, tokenizer=tokenizer, **data)

    @property
    def _llm_type(self):
        return "huggingface_local"

    def __call__(self, prompt: str, **gen_kwargs) -> str:
        return self._call(prompt, **gen_kwargs)

    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        device = next(self.model.parameters()).device
        inputs = self.tokenizer(prompt, return_tensors="pt").to(device)
        output = self.model.generate(   **inputs,      
                                        max_new_tokens=768,      # Gives enough room for ~550 words
                                        min_new_tokens=60,       # Prevents premature empty stops
                                        temperature=0.5,         # 0.2 is too low for small models and causes loops; 0.5 works better
                                        repetition_penalty=1.18, # Prevents looping on lists
                                        no_repeat_ngram_size=3)
        
        return self.tokenizer.decode(output[0], skip_special_tokens=True)



class LLMNRAG:
    def __init__(self,prompt=None):

        if prompt is None:
            self.prompt = """<|system|>
                                You are an expert Dungeon Master in Dungeons & Dragons.
                                Guidelines:
                                1. Answer the user's question directly and creatively.
                                2. Incorporate provided story context and rule details naturally into your response.
                                3. If rule context is absent or irrelevant, rely on general D&D knowledge.
                                4. Do NOT repeat the instructions, XML tags, or prompt history.<|end|>
                                <|user|>
                                <campaign_summary>
                                {summary}
                                </campaign_summary>

                                <relevant_entities>
                                {entities}
                                </relevant_entities>

                                <recent_history>
                                {history}
                                </recent_history>

                                <retrieved_rules>
                                {context}
                                </retrieved_rules>

                                User Request: {question}<|end|>
                                <|assistant|>
                          """
        else:
            self.prompt = prompt

        self.setup_RAG()


    def rephrase_query_for_rag(self,chat_summary: str, recent_history: str, user_question: str, llm_func) -> str:
        """
        Rewrites a conversational follow-up question into a standalone search query.
        If the question is already standalone, returns it as-is.
        """
        # If there is no prior conversation, no rephrasing is needed
        if not chat_summary and not recent_history:
            return user_question

        rephrase_prompt = f"""<|system|>
        Given the conversation context, rewrite the user's latest question into a single standalone search query for a D&D rulebook.
        Do NOT answer the question. Only output the standalone search query.<|end|>
        <|user|>
        Context Summary: {chat_summary}
        Recent History: {recent_history}

        User Question: {user_question}

        Standalone Search Query:<|end|>
        <|assistant|>"""

        raw_query = llm_func(rephrase_prompt).strip()
        
        # Strip echoes or assistant markers if present
        if "<|assistant|>" in raw_query:
            raw_query = raw_query.split("<|assistant|>")[-1]
            
        clean_query = raw_query.strip().strip('"')
        
        # Fallback to original question if output looks weird
        return clean_query if len(clean_query) > 3 else user_question

    def summarize_chat_state(self,old_summary: str, recent_turns: str, llm_func) -> str:
        """
        Extracts key conversation facts and merges them into a tiny bulleted summary block.
        """

        summary_prompt = f"""<|system|>
        You are a conversation state extractor for a D&D game.
        Update the existing summary using the new conversation.
        Rules:
        1. Extract ONLY key facts, character details, rules asked, and decisions made.
        2. Keep it under 4 bullet points max.
        3. Do NOT include greetings or long descriptions.
        4. setup campagin state as follow:
           * Activte Characters
        <|end|>
        <|user|>
        Existing Summary:
        {old_summary if old_summary else "None"}

        New Messages:
        {recent_turns}

        Updated Summary (Bullet points):<|end|>
        <|assistant|>"""

        raw_summary = llm_func(summary_prompt)
        
        # Strip echoes or assistant markers if present
        if "<|assistant|>" in raw_summary:
            raw_summary = raw_summary.split("<|assistant|>")[-1]
            
        return raw_summary.strip()


    def clean_text(self,raw_respones):
        text = raw_respones.lstrip()

        if "<|assistant|>" in text:
            text = text.split("<|assistant|>")[-1]

        text = re.sub(r"<\|.+?\|>|\|<\|.+?\|>", "", text)

        return text

    def answer_with_rag(
        self, 
        question: str, 
        recent_history: str = "",
        summary: str = "",
        entities: str = "", 
        k: int = 3,             # Reduced from 6 to prevent prompt saturation on <5GB models
        max_chars: int = 5000,  # Keeps context under ~450 tokens to stop repetition loops
        score_threshold: float = 0.55
            ) -> tuple[str]:
        
        summary_str = self.summarize_chat_state(summary,recent_history,self.llm)

        search_query = self.rephrase_query_for_rag(
        chat_summary=summary_str,
        recent_history=recent_history,
        user_question=question,
        llm_func=self.llm
        )
        
        # 1. Retrieve relevant documents using score filtering
        docs = retrieve_documents(
            self.retriever, 
            self.db, 
            query=search_query, 
            k=k, 
            score_threshold=score_threshold
        )


        # 2. Build structured context string from retrieved docs list
        context = build_context(docs, max_chars=max_chars)

        # 3. Format the chat prompt template
        prompt = self.prompt.format(
            context=context, 
            question=question, 
            history=recent_history if recent_history else "No previous history.",
            summary=summary_str if summary_str else "No summary of session.",
            entities=entities if entities else "No refernce given."
        )

        # 4. Invoke the LLM model
        raw_response = self.llm(prompt)
        
        # 5. Clean prompt echoes and repeating loops
        clean_answer = self.clean_text(raw_response)

        return clean_answer, summary_str
    
    def setup_RAG(self):
        all_chunks = []
        for filename in glob('./RAGdata/dnd_data/Races/*/*.json'):
            print("Loading", filename)
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
            chunks = extract_chunks(data)
            # attach source filename to each chunk's metadata later
            for c in chunks:
                c.setdefault("source", filename)
            all_chunks.extend(chunks)

        documents = [chunk_to_document(c, i) for i, c in enumerate(all_chunks)]
        print("Total documents:", len(documents))

        embedder = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

        try:
            db = FAISS.from_documents(documents, embedder)
        except Exception:
            # fallback if from_documents not available
            texts = [d.page_content for d in documents]
            db = FAISS.from_texts(texts, embedder)

        db.save_local("dnd_races_index")

        self.db = FAISS.load_local("dnd_races_index", embedder,allow_dangerous_deserialization=True)

        self.retriever = db.as_retriever(search_kwargs={"k": 4})

    def build_LLM(self,model_name):
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map="auto"
        )

        self.llm = HFLocalLLM(model, tokenizer)

