from pinecone import Pinecone

pc = Pinecone(api_key="pcsk_4ediTb_3DmC3WXeSLWMz1Ybhoh28QB2x52efdB9jurNhL53ettMBuvoL1UzjeXvMCLMBKs")

index_info = pc.describe_index("vault-ai-18")

print(index_info.host)