import json
import uuid
from app.db import connection
from app.config import settings

def history(tenant: str, conversation_id: uuid.UUID):
    with connection() as conn:
        rows = conn.execute("""SELECT role,content FROM (
            SELECT id,role,content,created_at FROM chat_messages
            WHERE tenant_id=%s AND conversation_id=%s ORDER BY id DESC LIMIT %s
        ) recent ORDER BY id ASC""", (tenant,conversation_id,settings().memory_turns*2)).fetchall()
    return rows

def save_turn(tenant: str, conversation_id: uuid.UUID, question: str, response: str, sources: list | None = None):
    with connection() as conn:
        try:
            with conn.transaction():
                sources_json = json.dumps(sources or [])
                conn.execute("""INSERT INTO chat_messages(tenant_id,conversation_id,role,content,sources)
                                VALUES (%s,%s,'user',%s,'[]'::jsonb),(%s,%s,'assistant',%s,%s::jsonb)""",
                             (tenant,conversation_id,question,tenant,conversation_id,response,sources_json))
        except Exception:
            with conn.transaction():
                conn.execute("""INSERT INTO chat_messages(tenant_id,conversation_id,role,content)
                                VALUES (%s,%s,'user',%s),(%s,%s,'assistant',%s)""",
                             (tenant,conversation_id,question,tenant,conversation_id,response))

def list_messages(tenant: str, conversation_id: uuid.UUID):
    with connection() as conn:
        try:
            with conn.transaction():
                return conn.execute("""SELECT role,content,created_at,coalesce(sources,'[]'::jsonb) as sources FROM chat_messages
                  WHERE tenant_id=%s AND conversation_id=%s ORDER BY id ASC LIMIT 100""",
                  (tenant,conversation_id)).fetchall()
        except Exception:
            with conn.transaction():
                return conn.execute("""SELECT role,content,created_at FROM chat_messages
                  WHERE tenant_id=%s AND conversation_id=%s ORDER BY id ASC LIMIT 100""",
                  (tenant,conversation_id)).fetchall()

def list_conversations(tenant: str):
    with connection() as conn:
        rows = conn.execute("""
            WITH user_titles AS (
                SELECT DISTINCT ON (conversation_id)
                    conversation_id,
                    content AS title
                FROM chat_messages
                WHERE tenant_id = %s AND role = 'user'
                ORDER BY conversation_id, id ASC
            ),
            stats AS (
                SELECT 
                    conversation_id,
                    MAX(created_at) AS updated_at,
                    COUNT(*) AS message_count
                FROM chat_messages
                WHERE tenant_id = %s
                GROUP BY conversation_id
            )
            SELECT 
                s.conversation_id,
                COALESCE(u.title, 'New Conversation') AS title,
                s.updated_at,
                s.message_count
            FROM stats s
            LEFT JOIN user_titles u ON s.conversation_id = u.conversation_id
            ORDER BY s.updated_at DESC
            LIMIT 50
        """, (tenant, tenant)).fetchall()
        return [
            {
                'conversation_id': str(r['conversation_id']),
                'title': r['title'],
                'updated_at': r['updated_at'].isoformat() if hasattr(r['updated_at'], 'isoformat') else str(r['updated_at']),
                'message_count': r['message_count']
            }
            for r in rows
        ]

def delete_conversation(tenant: str, conversation_id: uuid.UUID):
    with connection() as conn:
        conn.execute("DELETE FROM chat_messages WHERE tenant_id = %s AND conversation_id = %s",
                     (tenant, conversation_id))
