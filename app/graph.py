import re
from typing import TypedDict, Any
from langgraph.graph import StateGraph, START, END
from app.observability import trace
from app.aws import embed, answer
from app.vector import search
from app.config import settings
from app.guardrails import check_input, check_output, check_evidence, classify_input

MAX_TURNS = 6
MAX_MSG_CHARS = 2000


class State(TypedDict, total=False):
    question: str
    principal: Any
    passages: list
    answer: str
    sources: list
    status: str
    history: list
    flagged: list


def clean_history(history):
    """Keep only well-formed user/assistant turns, capped in count and length."""
    out = []
    for m in (history or [])[-MAX_TURNS * 2:]:
        if not isinstance(m, dict) or m.get('role') not in ('user', 'assistant'):
            continue
        content = m.get('content')
        if not isinstance(content, str):
            continue
        if m['role'] == 'user' and classify_input(content):
            continue  # drop earlier turns that would have been blocked today
        out.append({'role': m['role'], 'content': content[:MAX_MSG_CHARS]})
    return out


def guard(s):
    return {'question': check_input(s['question']), 'history': clean_history(s.get('history'))}


def retrieve(s):
    p = s['principal']
    prior = [m['content'] for m in s['history'] if m['role'] == 'user']
    query = (prior[-1] + '\nFollow-up: ' + s['question']) if prior else s['question']
    hits = search(p.tenant, embed(query), p.groups, p.subject)
    hits = [h for h in hits if h['score'] >= settings().min_relevance]
    sources = [{
        'index': i + 1,
        'document_id': h['metadata'].get('document_id', ''),
        'title': h['metadata'].get('title', ''),
        'page': h['metadata'].get('page', 1),
        'excerpt': h['metadata'].get('text', '')[:320],
    } for i, h in enumerate(hits)]
    return {'passages': hits, 'sources': sources}


def route(s):
    return 'generate' if s['passages'] else 'no_evidence'


def no_evidence(s):
    return {'answer': 'I could not find supporting evidence in documents you are authorized to access.',
            'status': 'no_evidence'}


def generate(s):
    chunks = [
        f'{h["metadata"].get("title", "Document")}, page {h["metadata"].get("page", 1)}:\n'
        f'{h["metadata"].get("text", "")}'
        for h in s['passages']
    ]
    evidence, flagged = check_evidence(chunks)  # ids start at 1 to match citations
    return {'answer': answer(s['question'], evidence, s['history']),
            'status': 'answered', 'flagged': flagged}


def validate(s):
    n = len(s['sources'])
    text = check_output(s['answer'])
    # Remove citations that don't point at a real source.
    text = re.sub(r'\[(\d+)\]', lambda m: m.group(0) if 1 <= int(m.group(1)) <= n else '', text)
    sources = [{**src, 'excerpt': check_output(src['excerpt'])} for src in s['sources']]
    return {'answer': text, 'sources': sources}


def make_graph():
    g = StateGraph(State)
    for name, fn in [('guard', guard), ('retrieve', retrieve), ('no_evidence', no_evidence),
                     ('generate', generate), ('validate', validate)]:
        g.add_node(name, fn)
    g.add_edge(START, 'guard')
    g.add_edge('guard', 'retrieve')
    g.add_conditional_edges('retrieve', route, {'generate': 'generate', 'no_evidence': 'no_evidence'})
    g.add_edge('generate', 'validate')
    g.add_edge('validate', END)
    g.add_edge('no_evidence', END)
    return g.compile()


graph = make_graph()


@trace("chat")
def chat(p, question, history=None):
    r = graph.invoke({'principal': p, 'question': question, 'history': history or []})
    return {'answer': r['answer'], 'sources': r.get('sources', []), 'status': r.get('status', 'answered')}