"""Plot the metrics CSV that train.py writes.

Usage, from game/sim:
    .venv/bin/python python/plot.py

Writes data/metrics.png and prints its path.
"""

import csv
import os

import matplotlib

matplotlib.use("Agg")  # render to a file; no display needed
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
METRICS_PATH = os.path.join(HERE, "..", "data", "metrics.csv")
OUTPUT_PATH = os.path.join(HERE, "..", "data", "metrics.png")

# (column in the report, subplot title, what a healthy run looks like)
PANELS = [
    ("Policy Reward", "Policy Reward", "should trend upward"),
    ("Policy Entropy", "Policy Entropy", "starts ~ln(13)=2.56, falls as it commits"),
    ("Value Function Loss", "Value Function Loss", "falls as the critic learns"),
    ("Overall Steps per Second", "Steps per Second", "flat; drops mean a bottleneck"),
]


def main():
    with open(METRICS_PATH, newline="") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        raise SystemExit(f"no data rows in {METRICS_PATH} -- has train.py run?")

    def column(name):
        return [float(row[name]) for row in rows if row.get(name) not in (None, "", "nan")]

    timesteps = column("Cumulative Timesteps")

    fig, axes = plt.subplots(2, 2, figsize=(12, 7))
    fig.suptitle(f"training run -- {len(rows)} iterations")

    for ax, (key, title, hint) in zip(axes.flat, PANELS):
        values = column(key)
        # nan-filtered columns can be shorter than the x axis (e.g. Value
        # Function Loss is blanked on the first iteration).
        ax.plot(timesteps[len(timesteps) - len(values):], values)
        ax.set_title(title, fontsize=11)
        ax.set_xlabel(hint, fontsize=8, color="gray")
        ax.grid(True, alpha=0.3)

    fig.tight_layout()
    fig.savefig(OUTPUT_PATH, dpi=120)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
