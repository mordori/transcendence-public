import torch
import sys
import os

# Ensure we can import the policy from rlgym_ppo
from rlgym_ppo.ppo import DiscreteFF

def perform_surgery(old_path, new_path):
    print(f"Loading old 28-input policy from {old_path}...")
    old_policy = DiscreteFF(28, 13, (2048, 2048, 1024, 1024), device="cpu")
    old_policy.load_state_dict(torch.load(old_path, map_location="cpu", weights_only=True))

    print("Creating new 108-input policy...")
    new_policy = DiscreteFF(108, 13, (2048, 2048, 1024, 1024), device="cpu")
    
    # Grab the dictionaries holding the neural network weights
    old_weights = old_policy.state_dict()
    new_weights = new_policy.state_dict()

    print("Performing brain surgery...")
    for key, value in old_weights.items():
        if key == "model.0.weight":
            # This is the very first layer! It is a matrix of size (2048, 108).
            # We copy the old 28 columns perfectly.
            new_weights[key][:, :28] = value
            # We ensure the 80 new columns for the other cars are exactly 0.0
            new_weights[key][:, 28:] = 0.0
        else:
            # All other hidden layers are perfectly identical!
            new_weights[key] = value

    # Save the new brain!
    torch.save(new_weights, new_path)
    print(f"Surgery complete! New policy saved to {new_path}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python surgery.py <old_policy.pt> <new_policy.pt>")
        sys.exit(1)
        
    perform_surgery(sys.argv[1], sys.argv[2])

