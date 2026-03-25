from dataclasses import dataclass
import os
import logging

logger = logging.getLogger(__name__)


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
    """Load settings from environment variables with validation."""
    try:
        ml_alpha = float(os.getenv("PITWALL_ML_ALPHA", "0.7"))
        if not 0.0 <= ml_alpha <= 1.0:
            logger.warning(f"ml_alpha out of bounds (0-1): {ml_alpha}, using default 0.7")
            ml_alpha = 0.7
    except ValueError:
        logger.warning(f"Invalid ml_alpha value, using default 0.7")
        ml_alpha = 0.7
    
    try:
        ml_ridge_lambda = float(os.getenv("PITWALL_ML_RIDGE_LAMBDA", "1.5"))
        if ml_ridge_lambda < 0:
            logger.warning(f"ml_ridge_lambda negative: {ml_ridge_lambda}, using default 1.5")
            ml_ridge_lambda = 1.5
    except ValueError:
        logger.warning(f"Invalid ml_ridge_lambda value, using default 1.5")
        ml_ridge_lambda = 1.5
    
    try:
        replay_speed = float(os.getenv("PITWALL_REPLAY_SPEED", "1.0"))
        if replay_speed <= 0:
            logger.warning(f"replay_speed non-positive: {replay_speed}, using default 1.0")
            replay_speed = 1.0
    except ValueError:
        logger.warning(f"Invalid replay_speed value, using default 1.0")
        replay_speed = 1.0
    
    try:
        udp_port = int(os.getenv("PITWALL_UDP_PORT", "20777"))
        if not 1 <= udp_port <= 65535:
            logger.warning(f"udp_port out of range: {udp_port}, using default 20777")
            udp_port = 20777
    except ValueError:
        logger.warning(f"Invalid udp_port value, using default 20777")
        udp_port = 20777
    
    try:
        ws_port = int(os.getenv("PITWALL_WS_PORT", "8765"))
        if not 1 <= ws_port <= 65535:
            logger.warning(f"ws_port out of range: {ws_port}, using default 8765")
            ws_port = 8765
    except ValueError:
        logger.warning(f"Invalid ws_port value, using default 8765")
        ws_port = 8765
    
    return Settings(
        udp_host=os.getenv("PITWALL_UDP_HOST", "0.0.0.0"),
        udp_port=udp_port,
        ws_host=os.getenv("PITWALL_WS_HOST", "127.0.0.1"),
        ws_port=ws_port,
        replay_mode=os.getenv("PITWALL_REPLAY_MODE", "false").lower() == "true",
        replay_path=os.getenv("PITWALL_REPLAY_PATH", ""),
        replay_speed=replay_speed,
        raw_log_path=os.getenv("PITWALL_RAW_LOG_PATH", "./data/raw_packets.log"),
        ml_enabled=os.getenv("PITWALL_ML_ENABLED", "true").lower() == "true",
        ml_alpha=ml_alpha,
        ml_model_path=os.getenv("PITWALL_ML_MODEL_PATH", "./data/strategy_model.json"),
        ml_ridge_lambda=ml_ridge_lambda,
    )
