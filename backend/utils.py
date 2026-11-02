from langchain_core.documents import Document
from typing import Any, List

def chunk_to_document(chunk, idx):
    title = chunk.get("title") or f"chunk_{idx}"
    content = chunk.get("content") or ""
    meta = dict(chunk.get("meta") or {})
    meta.setdefault("title", title)
    meta.setdefault("source", chunk.get("source"))
    return Document(page_content=f"{title}\n{content}", metadata=meta)

def extract_chunks(obj, parent=""):
    chunks = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            new_parent = f"{parent}.{key}" if parent else key
            if key == "text" and isinstance(value, str):
                chunks.append({"title": parent, "content": value})
            elif isinstance(value, dict):
                chunks.extend(extract_chunks(value, new_parent))
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    chunks.extend(extract_chunks(item, f"{new_parent}[{i}]"))
            elif isinstance(value, (str, int, float)):
                chunks.append({"title": new_parent, "content": str(value)})
    return chunks

def build_context(
    docs: List[Any], 
    max_chars: int = 3000,  # ~400-450 tokens max (Ideal for <5GB models)
    fallback_text: str = "No specific rulebook context found. Answer using general D&D knowledge."
) -> str:
    """
    Join retrieved docs into a single context string, truncating cleanly at line boundaries.
    Provides a clear fallback message when no documents pass the threshold.
    """
    if not docs:
        return fallback_text

    parts = []
    total = 0

    for d in docs:
        # 1. Safely extract metadata title and page content
        metadata = getattr(d, "metadata", {}) or {}
        title = metadata.get("title") or metadata.get("source")
        text = getattr(d, "page_content", str(d)).strip()
        
        # 2. Format with clean structural headers instead of bracket strings
        header = f"### Source: {title}\n" if title else ""
        chunk = header + text

        # 3. Handle character limits cleanly
        if total + len(chunk) > max_chars:
            remaining = max_chars - total
            if remaining > 50:  # Only add if a meaningful snippet fits
                truncated_chunk = chunk[:remaining]
                # Avoid cutting mid-word if possible
                if " " in truncated_chunk:
                    truncated_chunk = truncated_chunk.rsplit(" ", 1)[0]
                parts.append(truncated_chunk + "...")
            break
            
        parts.append(chunk)
        total += len(chunk)

    result = "\n\n".join(parts).strip()
    return result if result else fallback_text

def retrieve_documents(
    retriever: Any, 
    db: Any, 
    query: str, 
    k: int = 6, 
    score_threshold: float = 0.5  # Adjust based on your vector store distance/score metric
) -> List[Any]:
    
    docs_with_scores = []

    # 1. Try vector DB similarity search with score if available
    if db is not None and hasattr(db, "similarity_search_with_relevance_scores"):
        try:
            docs_with_scores = db.similarity_search_with_relevance_scores(query, k=k)
            # Filter out docs below threshold
            return [doc for doc, score in docs_with_scores if score >= score_threshold]
        except Exception:
            pass

    # 2. Try similarity search with score alternative (e.g., Chroma / FAISS distance)
    if db is not None and hasattr(db, "similarity_search_with_score"):
        try:
            # Note: For distance metrics (like L2 or cosine distance), LOWER is better.
            # If using cosine similarity (0 to 1), HIGHER is better.
            docs_with_scores = db.similarity_search_with_score(query, k=k)
            # Example threshold filtering for similarity scores:
            return [doc for doc, score in docs_with_scores if score >= score_threshold]
        except Exception:
            pass

    # 3. Fallback to standard retrieval if score methods are unavailable
    sync_names = [
        "invoke",                  # Modern LangChain standard (LCEL)
        "get_relevant_documents", 
        "retrieve", 
        "similarity_search"
    ]
    
    for name in sync_names:
        obj = retriever if hasattr(retriever, name) else (db if hasattr(db, name) else None)
        if obj is not None:
            method = getattr(obj, name)
            try:
                return method(query) if name not in ["similarity_search", "similarity_search_with_score"] else method(query, k=k)
            except TypeError:
                return method(query, k)

    if callable(retriever):
        return retriever(query)

    raise AttributeError("No supported retrieval method found on retriever or db.")



