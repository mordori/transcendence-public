from .state import GameState

__all__ = [
    "GameState",
    "TranscendenceEngine",
    "build_env",
    "build_rlgym_env",
]


def __getattr__(name):
    if name == "TranscendenceEngine":
        from .engine import TranscendenceEngine
        value = TranscendenceEngine
    elif name in ("build_env", "build_rlgym_env"):
        from .env import build_env, build_rlgym_env
        value = {
            "build_env": build_env,
            "build_rlgym_env": build_rlgym_env,
        }[name]
    else:
        raise AttributeError(name)

    globals()[name] = value
    return value