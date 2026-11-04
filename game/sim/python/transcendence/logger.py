import numpy as np
from rlgym_ppo.util.metrics_logger import MetricsLogger

class TranscendenceMetricsLogger(MetricsLogger):
    def _collect_metrics(self, game_state):
        team_0_score = 1.0 if game_state.ball_in_goal and game_state.scoring_team == 0 else 0.0
        team_1_score = 1.0 if game_state.ball_in_goal and game_state.scoring_team == 1 else 0.0
        
        touches = 0.0
        bot_team = -1.0  # Default if multiplayer

        for car in game_state.cars.values():
            if car.touched_ball:
                touches += 1.0
                
        # If we are in 1v0 mode, grab the exact team ID of the single bot on the field
        if len(game_state.cars) == 1:
            bot_team = float(list(game_state.cars.values())[0].team)

        num_orange = float(game_state.orange_idx)
        num_blue = float(game_state.blue_idx)
                
        return [np.array([team_0_score, team_1_score, touches, bot_team, num_orange, num_blue], dtype=np.float32)]

    def _report_metrics(self, collected_metrics, wandb_run, cumulative_timesteps):
        total_team_0_goals = 0.0
        total_team_1_goals = 0.0
        total_touches = 0.0
        detected_bot_team = -1.0
        last_num_orange = 0
        last_num_blue = 0
        
        for metric_arrays in collected_metrics:
            stats = metric_arrays[0]
            total_team_0_goals += stats[0]
            total_team_1_goals += stats[1]
            total_touches += stats[2]
            detected_bot_team = stats[3]  # Will take the last recorded state
            last_num_orange = int(stats[4])
            last_num_blue = int(stats[5])
            
        total_goals = total_team_0_goals + total_team_1_goals
        matchup = f"{last_num_orange}vs{last_num_blue}"
        
        report = {
            "Match/Total Goals": total_goals,
            "Match/Team 0 (Orange) Goals": total_team_0_goals,
            "Match/Team 1 (Blue) Goals": total_team_1_goals,
            "Match/Total Touches": total_touches,
            "Match size:": matchup,
        }
        
        print(f"\n--- TRANSCENDENCE MATCH METRICS ---")
        print(f"Total Goals Scored: {total_goals}")
        
        # If it's 1v0, print the stats specifically for the bot's team
        if detected_bot_team != -1.0:
            bot_team_id = int(detected_bot_team)
            
            # Dynamically assign names based on the state.py rules
            bot_team_name = f"Team {bot_team_id} ({'Blue' if bot_team_id == 1 else 'Orange'})"
            opp_team_name = f"Team {1 - bot_team_id} ({'Orange' if bot_team_id == 1 else 'Blue'})"
            
            # Dynamically route the goals
            bot_goals = total_team_1_goals if bot_team_id == 1 else total_team_0_goals
            own_goals = total_team_0_goals if bot_team_id == 1 else total_team_1_goals
            
            bot_win_rate = (bot_goals / total_goals) if total_goals > 0 else 0.0
            
            print(f"Training Mode: 1v0")
            print(f"Bot Identity: {bot_team_name}")
            print(f"Bot Scored on Opposite Team ({opp_team_name}): {bot_goals}")
            print(f"Bot Scored Own Goal (in {bot_team_name} net): {own_goals}")
            print(f"Bot Scoring Accuracy: {bot_win_rate * 100:.1f}%")
            
            report["Match/Bot Scoring Accuracy"] = bot_win_rate
        else:
            # Multiplayer Self-Play Mode
            team_1_win_rate = (total_team_1_goals / total_goals) if total_goals > 0 else 0.0
            print(f"Training Mode: Multiplayer")
            print(f"Team 1 (Blue) Win Rate: {team_1_win_rate * 100:.1f}%")
            print(f"Team 1 goals: ", total_team_1_goals)
            print("Team 0 goals: ", total_team_0_goals)
            print(f"Match size: ", matchup)
            
        print(f"Total Ball Touches: {total_touches}")
        print(f"-----------------------------------\n")

        if wandb_run is not None:
            wandb_run.log(report, step=cumulative_timesteps)