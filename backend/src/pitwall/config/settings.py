from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    udp_host: str = "0.0.0.0"
    udp_port: int = 20777
    ws_host: str = "127.0.0.1"
    ws_port: int = 8765
    replay_mode: bool = False
    replay_path: str = ""
    replay_speed: float = 1.0
    raw_log_path: str = "./data/raw_packets.log"
    ml_enabled: bool = True
    ml_alpha: float = 0.7
    ml_model_path: str = "./data/strategy_model.json"
    ml_ridge_lambda: float = 1.5


def load_settings() -> Settings:
    return Settings(
        udp_host=os.getenv("PITWALL_UDP_HOST", "0.0.0.0"),
        udp_port=int(os.getenv("PITWALL_UDP_PORT", "20777")),
        ws_host=os.getenv("PITWALL_WS_HOST", "127.0.0.1"),
        ws_port=int(os.getenv("PITWALL_WS_PORT", "8765")),
        replay_mode=os.getenv("PITWALL_REPLAY_MODE", "false").lower() == "true",
        replay_path=os.getenv("PITWALL_REPLAY_PATH", ""),
        replay_speed=float(os.getenv("PITWALL_REPLAY_SPEED", "1.0")),
        raw_log_path=os.getenv("PITWALL_RAW_LOG_PATH", "./data/raw_packets.log"),
        ml_enabled=os.getenv("PITWALL_ML_ENABLED", "true").lower() == "true",
        ml_alpha=float(os.getenv("PITWALL_ML_ALPHA", "0.7")),
        ml_model_path=os.getenv("PITWALL_ML_MODEL_PATH", "./data/strategy_model.json"),
        ml_ridge_lambda=float(os.getenv("PITWALL_ML_RIDGE_LAMBDA", "1.5")),
    )
