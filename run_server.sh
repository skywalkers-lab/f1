
#!/bin/bash
cd backend
source .venv/bin/activate
uvicorn pitwall.main:app --reload