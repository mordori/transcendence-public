import csv
import json
import os
import sys
import torch

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rlgym_ppo import Learner
from rlgym_ppo.util import reporting
from transcendence.env import build_env
from transcendence.logger import TranscendenceMetricsLogger

_json_default = json.JSONEncoder.default


def _numpy_safe_default(self, o):
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return _json_default(self, o)


json.JSONEncoder.default = _numpy_safe_default

METRICS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "metrics.csv")

_print_report = reporting.report_metrics
_metrics_file = None


def _tee_report(loggable_metrics, debug_metrics, wandb_run):
    global _metrics_file

    scalars = {
        key: float(value)
        for key, value in loggable_metrics.items()
        if isinstance(value, (int, float, np.floating, np.integer))
    }

    if _metrics_file is None:
        os.makedirs(os.path.dirname(METRICS_PATH), exist_ok=True)
        _metrics_file = open(METRICS_PATH, "w", newline="")
        writer = csv.DictWriter(_metrics_file, fieldnames=list(scalars), extrasaction="ignore")
        writer.writeheader()
        _tee_report.writer = writer

    _tee_report.writer.writerow(scalars)
    _metrics_file.flush()

    _print_report(loggable_metrics=loggable_metrics, debug_metrics=debug_metrics, wandb_run=wandb_run)


reporting.report_metrics = _tee_report


if __name__ == "__main__":
    n_proc = 8

    learner = Learner(
        build_env,
        n_proc=n_proc,
        min_inference_size=max(1, int(round(n_proc * 0.9))),
        metrics_logger=TranscendenceMetricsLogger(),
        ppo_batch_size=100_000,
        policy_layer_sizes=(2048, 2048, 1024, 1024),
        critic_layer_sizes=(2048, 2048, 1024, 1024),
        ts_per_iteration=100_000,
        exp_buffer_size=300_000,
        ppo_minibatch_size=50_000,
        ppo_ent_coef=0.0002,
        policy_lr=1e-4,
        critic_lr=1e-4,
        ppo_epochs=2,
        standardize_returns=True,
        standardize_obs=False,
        save_every_ts=1_000_000,
        timestep_limit=1_000_000_000,
        log_to_wandb=True,
        checkpoint_load_folder="/home/dohanix/Aalto/transcendence/data/checkpoints/rlgym-ppo-run-1790258318403684135/112804289",
    )

    # print("Injecting Surgical Brain...")
    # learner.ppo_learner.policy.load_state_dict(torch.load("/home/dohanix/Aalto/transcendence/NEW_PPO_POLICY.pt", map_location="cpu"))
    
    learner.learn()
