FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir websockets numpy wandb gym cloudpickle filelock typing_extensions
RUN pip install --no-cache-dir rlgym-api==2.0.0
RUN pip install --no-cache-dir --no-deps \
    git+https://github.com/AechPro/rlgym-ppo.git@4ffd2e924198bf4b2d59f4bf280b29919d7c07ea

COPY ./game/sim/python/transcendence ./game/sim/python/transcendence
COPY ./game/ai/mock_sim.py ./game/sim/python/transcendence_sim.py
COPY ./game/ai/bots.py ./game/ai/bots.py

CMD ["python", "-u", "./game/ai/bots.py"]