"""
Solo TableTop API  (run:  uvicorn server:app --reload --port 8000)

What the front end sends. Every route except /users and /models needs the header  X-User-Id: <user id>.

  GET  /api/users                          -> [{id, name}]
  POST /api/users            {name}        -> {id, name}                 (same name again = same user)
  GET  /api/models                         -> [{id, label, name}]
  GET  /api/characters                     -> [Character]                (only this user's)
  POST /api/create_character CharacterBase -> Character                  (sent by the character sheet window)
       CharacterBase = {name, race, className, level, ac, speed, abilities{str,dex,con,int,wis,cha},
                        features[], equipment[], avatarUrl?, hp{current,max}, resource?{label,current,max},
                        background, alignment, experience, appearance{age,height,weight,eyes,skin,hair},
                        savingThrows[ability keys], skills[skill keys], otherProficiencies[], deathSaves{successes,failures},
                        backstory}
  GET    /api/characters/{id}              -> Character
  PUT    /api/characters/{id}  CharacterBase -> Character                (edit; same body as create)
  PUT    /api/characters/{id}/death-saves {successes, failures} -> same   (the dots on the sheet)
  DELETE /api/characters/{id}              -> 204                        (also removed from every party)
  GET  /api/sessions                       -> [{id, name, updatedAt, characterIds}]
  POST /api/sessions         {name}        -> {id, name, updatedAt, characterIds}
  PATCH  /api/sessions/{id}  {name}        -> {id, name, updatedAt, characterIds}   (rename)
  DELETE /api/sessions/{id}                -> 204                        (history and party go with it)
  PUT  /api/sessions/{id}/party {members}  -> {id, name, updatedAt, characterIds}
  GET  /api/sessions/{id}/messages         -> [{id, role, text, at}]     (role: user | dm | system)
  POST /api/sessions/{id}/messages {role, text} -> {id, role, text, at}  (dice rolls are saved this way)
  POST /api/prompt  {session_id, prompt_id, prompt, user_id, model_id} -> {reply, createdCharacterId?}
       A prompt like "create me a character named Thorin, a dwarf fighter ..." (or /character ...) makes the
       model build a character sheet, which is saved to `characters`; the reply confirms it and
       createdCharacterId tells the front end to reload the character list.

MongoDB (database dnd_db):
  users      {id, name}
  characters {id, userId, ...CharacterBase}
  sessions   {id, userId, name, updatedAt, prompts: [{id, role, text, at}]}   <- the chat history
  partys     {id, session_id, members: [character id]}
  models     {id, label, name}                                                <- name is what build_LLM gets
"""
from model import LLMNRAG
from fastapi import FastAPI, APIRouter, Depends, Header, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from dotenv import load_dotenv

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

import ast
import json
import logging
import os
import re
import threading
import uuid
import time


# ---------------------------------------------------------------- models
ABILITY_KEYS = {"str", "dex", "con", "int", "wis", "cha"}
SKILL_KEYS = {
    "acrobatics", "animalHandling", "arcana", "athletics", "deception", "history", "insight", "intimidation",
    "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion",
    "sleightOfHand", "stealth", "survival",
}
MAX_CHARACTERS = 100  # GET /characters returns at most 100
load_dotenv()

class Hp(BaseModel):
    current: int = Field(ge=0, le=999)
    max: int = Field(ge=1, le=999)


class Resource(BaseModel):  # spell slots, ki, rage ... the second bar under HP
    label: str = Field(min_length=1, max_length=40)
    current: int = Field(ge=0, le=99)
    max: int = Field(ge=1, le=99)


class Appearance(BaseModel):
    age: str = Field(default="", max_length=30)
    height: str = Field(default="", max_length=30)
    weight: str = Field(default="", max_length=30)
    eyes: str = Field(default="", max_length=30)
    skin: str = Field(default="", max_length=30)
    hair: str = Field(default="", max_length=30)

    @field_validator("*")
    @classmethod
    def tidy(cls, v: str) -> str:
        return " ".join(v.split())


class DeathSaves(BaseModel):  # the dots on the sheet
    successes: int = Field(default=0, ge=0, le=3)
    failures: int = Field(default=0, ge=0, le=3)


class CharacterBase(BaseModel):  # what the character sheet window sends (no id: the server assigns it)
    name: str = Field(min_length=1, max_length=50)
    race: str = Field(min_length=1, max_length=40)
    className: str = Field(min_length=1, max_length=40)
    level: int = Field(ge=1, le=20)
    ac: int = Field(ge=0, le=40)
    speed: int = Field(ge=0, le=200)
    abilities: dict[str, int]  # exactly: str, dex, con, int, wis, cha  (1-30 each)
    features: list[str] = Field(default_factory=list, max_length=50)
    equipment: list[str] = Field(default_factory=list, max_length=100)
    avatarUrl: str | None = Field(default=None, max_length=400_000)  # URL or data: URL (bytes cannot travel as JSON)
    hp: Hp
    resource: Resource | None = None
    # extended sheet (all optional, so characters saved before it existed still load and save)
    background: str = Field(default="", max_length=60)
    alignment: str = Field(default="", max_length=30)
    experience: int = Field(default=0, ge=0, le=9_999_999)
    appearance: Appearance = Field(default_factory=Appearance)
    savingThrows: list[str] = Field(default_factory=list)  # ability keys the character is proficient in
    skills: list[str] = Field(default_factory=list)  # skill keys the character is proficient in
    otherProficiencies: list[str] = Field(default_factory=list, max_length=100)  # other proficiencies & languages
    deathSaves: DeathSaves = Field(default_factory=DeathSaves)
    backstory: str = Field(default="", max_length=4000)

    @field_validator("name", "race", "className")
    @classmethod
    def tidy_text(cls, v: str) -> str:
        v = " ".join(v.split())  # trim + collapse spaces
        if not v:
            raise ValueError("must not be empty")
        return v

    @field_validator("abilities")
    @classmethod
    def check_abilities(cls, v: dict[str, int]) -> dict[str, int]:
        if set(v) != ABILITY_KEYS:
            raise ValueError("abilities must contain exactly: str, dex, con, int, wis, cha")
        if any(not 1 <= score <= 30 for score in v.values()):
            raise ValueError("every ability score must be between 1 and 30")
        return v

    @field_validator("backstory")
    @classmethod
    def tidy_backstory(cls, v: str) -> str:
        return v.strip()

    @field_validator("background", "alignment")
    @classmethod
    def tidy_optional(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("savingThrows")
    @classmethod
    def check_saving_throws(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v) or not set(v) <= ABILITY_KEYS:
            raise ValueError("savingThrows must be unique ability keys: str, dex, con, int, wis, cha")
        return v

    @field_validator("skills")
    @classmethod
    def check_skills(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v) or not set(v) <= SKILL_KEYS:
            raise ValueError("skills must be unique skill keys, e.g. acrobatics, sleightOfHand")
        return v

    @field_validator("features", "equipment", "otherProficiencies")
    @classmethod
    def tidy_lines(cls, v: list[str]) -> list[str]:
        v = [line.strip() for line in v if line.strip()]
        if any(len(line) > 200 for line in v):
            raise ValueError("each line must be at most 200 characters")
        return v

    @model_validator(mode="after")
    def check_pools(self):
        if self.hp.current > self.hp.max:
            raise ValueError("current hit points cannot be above the maximum")
        if self.resource and self.resource.current > self.resource.max:
            raise ValueError("current resource cannot be above the maximum")
        return self


class Character(CharacterBase):
    id: str
    userId: str


class SessionBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class Session(SessionBase):
    id: str


class UserBase(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class User(UserBase):
    id: str


class Prompt(BaseModel):
    session_id: str
    prompt_id: str  # id the front end gave the player's message
    prompt: str = Field(min_length=1, max_length=8000)
    user_id: str
    model_id: str


class Model(BaseModel):
    id: str
    label: str
    name: str


class Party(BaseModel):  # the stored document
    id: str
    session_id: str
    members: list[str]


MAX_PARTY = 6


class PartyIn(BaseModel):  # what the front end sends
    members: list[str] = Field(max_length=MAX_PARTY)


class MessageIn(BaseModel):
    role: Literal["user", "dm", "system"]
    text: str = Field(min_length=1, max_length=8000)


# ---------------------------------------------------------------- app
log = logging.getLogger("uvicorn.error")
MONGO_URL = os.getenv("MONGO_URL", f"mongodb://{os.getenv('MONGO_APP_USER')}:{os.getenv('MONGO_APP_PASS')}@mongodb:27017/dnd_db")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Connect on startup
    app.mongodb_client = AsyncIOMotorClient(MONGO_URL)
    app.db = app.mongodb_client["dnd_db"]
    yield
    # Disconnect on shutdown
    app.mongodb_client.close()


app = FastAPI(title="Solo TableTop", lifespan=lifespan)
api = APIRouter(prefix="/api")
llm_rag = LLMNRAG()

_llm_lock = threading.Lock()  # one request at a time may use the shared model
_loaded_model: str | None = None


def send_prompt(prompt: str, recent_history: str, session_summary : str, recent_prompts: list[dict], model: str):
    global _loaded_model
    with _llm_lock:
        if model != _loaded_model:  # only rebuild when the player switched model
            llm_rag.build_LLM(model)
            _loaded_model = model
        return llm_rag.answer_with_rag(prompt, recent_history, session_summary, recent_prompts)


def remove_mongo_id(data: list[dict]):
    for d in data:
        d.pop("_id", None)
    return data

def now_ms() -> int:
    return int(time.time() * 1000)

def make_message(role: str, text: str, msg_id: str | None = None) -> dict:
    return {"id": msg_id or uuid.uuid4().hex, "role": role, "text": text, "at": now_ms()}


def format_history(messages: list[dict]) -> str:
    names = {"user": "Player", "dm": "Dungeon Master", "system": "Note"}
    return "\n".join(f"{names.get(m.get('role'), 'Note')}: {m.get('text', '')}" for m in messages)


async def party_members(session_id: str) -> list[str]:
    party = await app.db["partys"].find_one({"session_id": session_id}, {"_id": 0, "members": 1})
    return party.get("members", []) if party else []


async def name_taken(user_id: str, name: str, except_id: str | None = None) -> bool:
    query: dict = {"userId": user_id, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if except_id:
        query["id"] = {"$ne": except_id}
    return await app.db["characters"].find_one(query, {"_id": 1}) is not None


def session_view(s: dict, members: list[str]) -> dict:
    return {"id": s["id"], "name": s["name"], "updatedAt": s.get("updatedAt", 0), "characterIds": members}


# The front end sends the logged-in user's id in X-User-Id; unknown id -> 401 -> back to the login page.
async def current_user_id(x_user_id: Annotated[str | None, Header()] = None) -> str:
    if not x_user_id or not await app.db["users"].find_one({"id": x_user_id}, {"_id": 1}):
        raise HTTPException(status_code=401, detail="Unknown user. Please log in again.")
    return x_user_id


UserId = Annotated[str, Depends(current_user_id)]


async def own_session(session_id: str, user_id: str, projection: dict) -> dict:
    session = await app.db["sessions"].find_one({"id": session_id, "userId": user_id}, projection) # TODO setup the mongodb to take last 2 prompts
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session


# ---------------------------------------------------------------- "create me a character" typed in the chat
# A chat message such as "create me a character named Thorin, a dwarf fighter who ..." skips the normal DM
# chat. The model is asked for the whole sheet as JSON, the answer is cleaned and checked with CharacterBase,
# saved in the characters collection, and the player gets a confirmation message back.
# Typing  /character <description>  always triggers it.

XP_BY_LEVEL = [
    0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
    85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
]
ABILITY_LOOKUP = {  # letters only, lower case -> ability key
    "str": "str", "strength": "str", "dex": "dex", "dexterity": "dex", "con": "con", "constitution": "con",
    "int": "int", "intelligence": "int", "wis": "wis", "wisdom": "wis", "cha": "cha", "charisma": "cha",
}
SKILL_LOOKUP = {key.lower(): key for key in SKILL_KEYS}  # "sleightofhand" -> "sleightOfHand"
CHARACTER_ATTEMPTS = 2  # the first try, plus one retry that tells the model what was wrong

_COMMAND = re.compile(r"^\s*/character\b[:,]?\s*", re.I)
_QUESTION = re.compile(r"^\s*(?:how|what|why|where|when|which|explain)\b", re.I)
# create / make / generate / build / design / roll up / give / add / "I want|need"  ...  character
# (a few words may sit in between, but not "my / the / our ..." so "add my character to the party" is left alone)
_CREATE_REQUEST = re.compile(
    r"\b(?:create|make|generate|build|design|roll\s+up|add|give|(?:i\s+)?(?:want|need))\b"
    r"(?:\s+(?!(?:my|our|his|her|their|the|this|that|your|its|me|any|you)\b)[\w&'-]+){0,5}?"
    r"\s+(?:character|char)\b",
    re.I,
)

CHARACTER_JSON_SHAPE = """{
  "name": "string",
  "race": "string",
  "className": "string",
  "level": 1,
  "background": "string",
  "alignment": "string",
  "abilities": {"str": 0, "dex": 0, "con": 0, "int": 0, "wis": 0, "cha": 0},
  "ac": 0,
  "speed": 0,
  "hp": {"max": 0},
  "resource": {"label": "string", "max": 0},
  "features": ["string"],
  "equipment": ["string"],
  "savingThrows": ["str"],
  "skills": ["athletics"],
  "otherProficiencies": ["string"],
  "appearance": {"age": "string", "height": "string", "weight": "string", "eyes": "string", "skin": "string", "hair": "string"},
  "backstory": "string"
}"""


def is_character_request(text: str) -> bool:
    """True when the player is asking the DM to make a new character."""
    if _COMMAND.match(text):
        return True
    return not _QUESTION.match(text) and bool(_CREATE_REQUEST.search(text))


def build_character_prompt(request: str, problem: str | None = None) -> str:
    """The instructions sent to the model. `problem` is set on the retry: what was wrong with the last answer."""
    request = _COMMAND.sub("", request).strip() or "Create a random level 1 character."
    prompt = (
        "You are a Dungeons & Dragons 5th edition rules expert. Build a complete player character sheet.\n\n"
        f'THE PLAYER\'S REQUEST:\n"""\n{request}\n"""\n\n'
        "RULES\n"
        "- Use the name, race, class and story the player gave. Whatever is missing, invent something that fits the rest.\n"
        "- level: 1 unless the player asked for another level (1 to 20).\n"
        "- abilities: use the standard array 15, 14, 13, 12, 10, 8 assigned to suit the class, then add the race's ability bonuses.\n"
        "- hp.max: the class hit die (maximum at level 1) plus the Constitution modifier; for every level above 1 add the average\n"
        "  of the hit die (rounded up) plus the Constitution modifier.\n"
        "- ac: from the armor and shield in equipment, or 10 + Dexterity modifier when unarmored.\n"
        "- speed: the race's walking speed in feet.\n"
        "- savingThrows: the two saving throws the class is proficient in, as ability keys (str, dex, con, int, wis, cha).\n"
        f"- skills: the class's skill choices plus the background's skills. Use only these keys: {', '.join(sorted(SKILL_KEYS))}.\n"
        "- otherProficiencies: armor, weapons, tools and languages.\n"
        "- features: the racial traits and class features the character has at this level, one short line each.\n"
        "- equipment: the starting equipment, one item per entry.\n"
        "- resource: the class resource to track (spell slots, ki points, rage, bardic inspiration...) with its maximum, or null if none.\n"
        "- background and alignment: a fitting background, and one of the nine alignments.\n"
        "- appearance: short phrases (under 30 characters each) that suit the race and the story.\n"
        "- backstory: 2 to 4 sentences built from the player's story.\n"
        "- Keep every list entry under 200 characters.\n\n"
        "ANSWER with ONE JSON object in exactly this shape and nothing else: no explanation, no markdown. "
        "Replace every placeholder with a real value.\n" + CHARACTER_JSON_SHAPE
    )
    if problem:
        prompt += f"\n\nYOUR PREVIOUS ANSWER WAS REJECTED: {problem}\nFix it and answer with the corrected JSON object only."
    return prompt


def _loads_loosely(text: str) -> dict:
    """JSON first (also with trailing commas), then a Python-style dict (single quotes, None, True)."""
    for candidate in (text, re.sub(r",\s*([}\]])", r"\1", text)):
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
    try:
        value = ast.literal_eval(text)
        if isinstance(value, dict):
            return value
    except (ValueError, SyntaxError):
        pass
    raise ValueError("the answer was not valid JSON")


def extract_json(answer: str) -> dict:
    """Finds the first {...} object in the model's answer, even inside ```json fences or after chatter."""
    text = answer.replace("```json", "").replace("```", "")
    start = text.find("{")
    if start == -1:
        raise ValueError("the answer contained no JSON object")
    depth, in_string, escaped = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return _loads_loosely(text[start : i + 1])
    raise ValueError("the JSON object was cut off")


def _text(value, limit: int) -> str:
    return " ".join(str(value).split())[:limit] if value is not None else ""


def _int(value, default: int, lo: int, hi: int) -> int:
    match = re.search(r"-?\d+", str(value)) if value is not None else None
    return max(lo, min(hi, int(match.group()) if match else default))


def _keys(value, lookup: dict[str, str]) -> list[str]:
    """['Animal Handling', 'stealth'] -> ['animalHandling', 'stealth']; unknown names are dropped."""
    if isinstance(value, dict):
        value = [k for k, on in value.items() if on]
    elif isinstance(value, str):
        value = re.split(r"[,;\n]", value)
    elif not isinstance(value, list):
        return []
    keys: list[str] = []
    for item in value:
        key = lookup.get(re.sub(r"[^a-z]", "", str(item).lower()))
        if key and key not in keys:
            keys.append(key)
    return keys


def _lines(value, max_items: int) -> list[str]:
    if isinstance(value, str):
        value = value.splitlines()
    if not isinstance(value, list):
        return []
    lines: list[str] = []
    for item in value:
        if isinstance(item, dict):  # {"name": "Second Wind", "description": "..."}
            name = _text(item.get("name") or item.get("title"), 80)
            desc = _text(item.get("description") or item.get("desc"), 200)
            item = f"{name}: {desc}" if name and desc else name or desc
        line = _text(item, 200)
        if line:
            lines.append(line)
    return lines[:max_items]


def clean_llm_character(raw: dict) -> dict:
    """Turns the model's JSON into something CharacterBase accepts: trims long text, maps skill names to keys,
    starts the character at full health, and fills the values the server owns (xp, death saves, portrait).
    Raises ValueError when something essential is missing, which triggers the retry."""
    abilities_raw = raw.get("abilities") or raw.get("ability_scores") or {}
    scores: dict[str, int] = {}
    if isinstance(abilities_raw, dict):
        for name, value in abilities_raw.items():
            key = ABILITY_LOOKUP.get(re.sub(r"[^a-z]", "", str(name).lower()))
            if key:
                scores[key] = _int(value, 10, 1, 30)
    missing = sorted(ABILITY_KEYS - set(scores))
    if missing:
        raise ValueError(f"abilities is missing: {', '.join(missing)}")

    hp = raw.get("hp")
    hp_max = _int(hp.get("max", hp.get("current")) if isinstance(hp, dict) else hp, 10, 1, 999)

    res = raw.get("resource")
    resource = None
    if isinstance(res, dict) and _text(res.get("label") or res.get("name"), 40):
        res_max = _int(res.get("max"), 1, 1, 99)
        resource = {"label": _text(res.get("label") or res.get("name"), 40), "current": res_max, "max": res_max}

    look = raw.get("appearance") if isinstance(raw.get("appearance"), dict) else {}
    level = _int(raw.get("level"), 1, 1, 20)
    return {
        "name": _text(raw.get("name"), 50),
        "race": _text(raw.get("race"), 40),
        "className": _text(raw.get("className") or raw.get("class"), 40),
        "level": level,
        "experience": XP_BY_LEVEL[level - 1],
        "background": _text(raw.get("background"), 60),
        "alignment": _text(raw.get("alignment"), 30),
        "abilities": scores,
        "ac": _int(raw.get("ac"), 10, 0, 40),
        "speed": _int(raw.get("speed"), 30, 0, 200),
        "hp": {"current": hp_max, "max": hp_max},
        "resource": resource,
        "features": _lines(raw.get("features"), 50),
        "equipment": _lines(raw.get("equipment"), 100),
        "savingThrows": _keys(raw.get("savingThrows"), ABILITY_LOOKUP),
        "skills": _keys(raw.get("skills"), SKILL_LOOKUP),
        "otherProficiencies": _lines(raw.get("otherProficiencies"), 100),
        "appearance": {k: _text(look.get(k), 30) for k in ("age", "height", "weight", "eyes", "skin", "hair")},
        "backstory": str(raw.get("backstory") or "").strip()[:4000],
        "deathSaves": {"successes": 0, "failures": 0},
        "avatarUrl": None,
    }


def describe_character(c, renamed_from: str | None = None) -> str:
    """The confirmation the player reads in the chat."""
    extras = ", ".join(x for x in (c.background, c.alignment) if x)
    a = c.abilities
    lines = [
        f"I created {c.name}: a level {c.level} {c.race} {c.className}" + (f" ({extras})" if extras else "") + ".",
        f"HP {c.hp.max}, AC {c.ac}, speed {c.speed} ft.",
        f"STR {a['str']}, DEX {a['dex']}, CON {a['con']}, INT {a['int']}, WIS {a['wis']}, CHA {a['cha']}.",
    ]
    if renamed_from:
        lines.append(f"You already had a character called {renamed_from}, so this one is named {c.name}.")
    lines.append(
        "The sheet is in your Characters tab: press the ? button to read it, or Edit to change anything. "
        "Add the character to a party from the session's party panel when you are ready."
    )
    return "\n".join(lines)


async def unique_character_name(user_id: str, name: str) -> str:
    candidate, n = name, 2
    while n < 200 and await name_taken(user_id, candidate):
        suffix = f" ({n})"
        candidate = name[: 50 - len(suffix)] + suffix
        n += 1
    return candidate


async def create_character_from_prompt(request: str, user_id: str, model_name: str) -> tuple[str, str | None]:
    """Asks the model for a whole character sheet, saves it, and returns (reply for the player, new character id)."""
    if await app.db["characters"].count_documents({"userId": user_id}) >= MAX_CHARACTERS:
        return f"You already have {MAX_CHARACTERS} characters, which is the most I can keep. Delete one and ask me again.", None

    sheet = None
    problem: str | None = None
    for _ in range(CHARACTER_ATTEMPTS):
        # no chat history here: the model only needs the player's request
        answer,_ = await run_in_threadpool(send_prompt, build_character_prompt(request, problem), "", "",[], model_name)
        try:
            sheet = CharacterBase.model_validate(clean_llm_character(extract_json(str(answer))))
            break
        except ValueError as err:  # bad JSON, a missing field, or a pydantic ValidationError (also a ValueError)
            if isinstance(err, ValidationError):
                problem = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in err.errors()[:6])
            else:
                problem = str(err)
            log.warning("character answer rejected (%s). Answer started: %.300s", problem, str(answer))

    if sheet is None:
        return (
            "I could not turn that into a valid character sheet, so nothing was saved. "
            "Try again with a name, race, class and a few lines of story, for example: "
            "\"Create a character named Thorin, a dwarf fighter who lost his clan's forge.\"",
            None,
        )

    data = sheet.model_dump()
    original_name = data["name"]
    data["name"] = await unique_character_name(user_id, original_name)
    character = Character(id=uuid.uuid4().hex, userId=user_id, **data)
    await app.db["characters"].insert_one(character.model_dump())
    return describe_character(character, original_name if character.name != original_name else None), character.id


# ---------------------------------------------------------------- users (no login needed)
@api.get("/users")
async def get_users() -> list[dict]:
    users = await app.db["users"].find({}, {"id": 1, "name": 1}).to_list(length=100)
    return remove_mongo_id(users)


@api.post("/users")
async def create_user(user: UserBase):
    name = " ".join(user.name.split())  # trim + collapse spaces
    if not name:
        raise HTTPException(status_code=422, detail="Please type a name.")
    # same name (any capitals) = same player, never a duplicate
    existing = await app.db["users"].find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0, "id": 1, "name": 1}
    )
    if existing:
        return existing
    new_user = User(id=uuid.uuid4().hex, name=name)
    await app.db["users"].insert_one({"id": new_user.id, "name": new_user.name})
    return new_user


# ---------------------------------------------------------------- models / characters
@api.get("/models")
async def get_models():
    models = await app.db["models"].find().to_list(length=100)
    models = remove_mongo_id(models)
    return models


@api.get("/characters")
async def get_characters(user_id: UserId):
    characters = await app.db["characters"].find({"userId": user_id}).to_list(length=100)
    characters = remove_mongo_id(characters)
    return characters


@api.post("/create_character", status_code=201)
async def create_character(character: CharacterBase, user_id: UserId):
    mine = app.db["characters"]
    if await mine.count_documents({"userId": user_id}) >= MAX_CHARACTERS:
        raise HTTPException(status_code=400, detail=f"You can have at most {MAX_CHARACTERS} characters.")
    if await name_taken(user_id, character.name):
        raise HTTPException(status_code=409, detail="You already have a character with that name.")
    new_character = Character(id=uuid.uuid4().hex, userId=user_id, **character.model_dump())
    await mine.insert_one(new_character.model_dump())
    return new_character


@api.get("/characters/{character_id}")
async def get_character(character_id: str, user_id: UserId):
    character = await app.db["characters"].find_one({"id": character_id, "userId": user_id}, {"_id": 0})
    if character is None:
        raise HTTPException(status_code=404, detail="Character not found.")
    return character


@api.put("/characters/{character_id}")
async def update_character(character_id: str, character: CharacterBase, user_id: UserId):
    if await name_taken(user_id, character.name, except_id=character_id):
        raise HTTPException(status_code=409, detail="You already have a character with that name.")
    result = await app.db["characters"].update_one(
        {"id": character_id, "userId": user_id}, {"$set": character.model_dump()}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Character not found.")
    return Character(id=character_id, userId=user_id, **character.model_dump())


@api.put("/characters/{character_id}/death-saves")
async def save_death_saves(character_id: str, saves: DeathSaves, user_id: UserId) -> dict:
    result = await app.db["characters"].update_one(
        {"id": character_id, "userId": user_id}, {"$set": {"deathSaves": saves.model_dump()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Character not found.")
    return saves.model_dump()


@api.delete("/characters/{character_id}", status_code=204)
async def delete_character(character_id: str, user_id: UserId):
    result = await app.db["characters"].delete_one({"id": character_id, "userId": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Character not found.")
    # take the character out of every party it was in
    session_ids = [s["id"] async for s in app.db["sessions"].find({"userId": user_id}, {"id": 1})]
    await app.db["partys"].update_many({"session_id": {"$in": session_ids}}, {"$pull": {"members": character_id}})
    return Response(status_code=204)


# ---------------------------------------------------------------- sessions
@api.get("/sessions")
async def get_sessions(user_id: UserId):
    sessions = (
        await app.db["sessions"]
        .find({"userId": user_id}, {"id": 1, "name": 1, "updatedAt": 1})
        .sort("updatedAt", -1)
        .to_list(length=100)
    )
    ids = [s["id"] for s in sessions]
    parties = await app.db["partys"].find({"session_id": {"$in": ids}}, {"session_id": 1, "members": 1}).to_list(length=100)
    members = {p["session_id"]: p.get("members", []) for p in parties}
    return [session_view(s, members.get(s["id"], [])) for s in sessions]


@api.post("/sessions", status_code=201)
async def create_session(body: SessionBase, user_id: UserId):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Please give the session a name.")
    session = Session(id=uuid.uuid4().hex, name=name)
    now = now_ms()
    await app.db["sessions"].insert_one(
        {"id": session.id, "userId": user_id, "name": session.name, "updatedAt": now, "prompts": []}
    )
    await app.db["partys"].insert_one({"id": uuid.uuid4().hex, "session_id": session.id, "members": []})
    return session_view({"id": session.id, "name": session.name, "updatedAt": now}, [])


@api.put("/sessions/{session_id}/party")
async def save_party(session_id: str, body: PartyIn, user_id: UserId) -> dict:
    session = await own_session(session_id, user_id, {"_id": 0, "id": 1, "name": 1})
    members = body.members
    if len(set(members)) != len(members):
        raise HTTPException(status_code=400, detail="A character can only be in the party once.")
    owned = await app.db["characters"].count_documents({"id": {"$in": members}, "userId": user_id})
    if owned != len(members):
        raise HTTPException(status_code=400, detail="Unknown character.")
    await app.db["partys"].update_one(
        {"session_id": session_id},
        {"$set": {"members": members}, "$setOnInsert": {"id": uuid.uuid4().hex}},
        upsert=True,
    )
    now = now_ms()
    await app.db["sessions"].update_one({"id": session_id}, {"$set": {"updatedAt": now}})
    return session_view({**session, "updatedAt": now}, members)


@api.patch("/sessions/{session_id}")
async def rename_session(session_id: str, body: SessionBase, user_id: UserId) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Please give the session a name.")
    session = await own_session(session_id, user_id, {"_id": 0, "id": 1, "updatedAt": 1})
    await app.db["sessions"].update_one({"id": session_id, "userId": user_id}, {"$set": {"name": name}})
    return session_view({**session, "name": name}, await party_members(session_id))


@api.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, user_id: UserId):
    result = await app.db["sessions"].delete_one({"id": session_id, "userId": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found.")
    await app.db["partys"].delete_many({"session_id": session_id})
    return Response(status_code=204)


# ---------------------------------------------------------------- messages (the session's history)
@api.get("/sessions/{session_id}/messages")
async def list_messages(session_id: str, user_id: UserId) -> list[dict]:
    session = await own_session(session_id, user_id, {"_id": 0, "prompts": 1})
    return session.get("prompts", [])


@api.post("/sessions/{session_id}/messages", status_code=201)
async def add_message(session_id: str, body: MessageIn, user_id: UserId) -> dict:
    msg = make_message(body.role, body.text)
    result = await app.db["sessions"].update_one(
        {"id": session_id, "userId": user_id},
        {"$push": {"prompts": msg}, "$set": {"updatedAt": msg["at"]}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found.")
    return msg


@api.post("/prompt")
async def receive_prompt(prompt: Prompt, user_id: UserId):
    if prompt.user_id != user_id:
        raise HTTPException(status_code=403, detail="That prompt belongs to another user.")
    session = await own_session(prompt.session_id, user_id, {"_id": 0, "prompts": {"$slice":2},"summary":1})
    model = await app.db["models"].find_one({"id": prompt.model_id}, {"_id": 0, "name": 1})
    if model is None:
        raise HTTPException(status_code=400, detail="Unknown model.")

    created_id: str | None = None
    if is_character_request(prompt.prompt):
        print("TRIGGER CREATE CHARACTERS")
        # "create me a character ...": the model builds a sheet, which is saved to the characters collection
        reply, created_id = await create_character_from_prompt(prompt.prompt, user_id, model["name"])
        new_summary = ""
    else:
        recent_history = format_history(session.get("prompts", []))
        # the model is slow and blocking: run it in a worker thread so the server stays responsive
        reply, new_summary = await run_in_threadpool(send_prompt, prompt.prompt, recent_history ,session.get("summary"),"", model["name"])
        reply = reply if isinstance(reply, str) else str(reply)

    await app.db["sessions"].update_one(
        {"id": prompt.session_id, "userId": user_id},
        {
            "$push": {
                "summary": new_summary,
                "prompts": {
                    "$each": [make_message("user", prompt.prompt, prompt.prompt_id), make_message("dm", reply)]
                }
            },
            "$set": {"updatedAt": now_ms()},
        },
    )
    return {"reply": reply, "createdCharacterId": created_id} if created_id else {"reply": reply}


app.include_router(api)
