import torch
import numpy as np
from transcendence.obs import DefaultObs
from transcendence.action import LookupTableAction
from transcendence.state import GameState


policy = torch.load("PPO_PoliCY.pt")
policy.eval()

obs_builder = DefaultObs()
action_parser = LookupTableAction()

def get_bot_action(flat_state_array, agent_id="blue_0"):
    state = GameState(flat_state_array)

    obs = obs_builder._build(state, agent_id)

    obs_tensor = torch.tensor(obs, dtype=torch.float32).unsqueeze(0)

    with torch.no_grad():
        action_idx, log_prob = policy.get_action(obs_tensor)
        action_idx = action_idx.item()


        action_dict = action_parser.parse_actions({agent_id: np.array([action_idx])}, state, {})

        return action_dict[agent_id].tolist()