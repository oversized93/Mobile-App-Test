extends Node2D
## Main — state machine and root controller for Zen River.
## Manages transitions between menu, play, and shop states.

enum State { MENU, PLAY, SHOP, RESET_CONFIRM }
var current_state: State = State.MENU

func _ready():
	GameData.load_game()
	# Connect signals
	GameData.milestone_reached.connect(_on_milestone)
	GameData.animal_collected.connect(_on_animal_collected)

func _on_milestone(msg: String):
	print("[Milestone] ", msg)
	# TODO: show notification overlay

func _on_animal_collected(payout: int, flow_time: float):
	# TODO: spawn float text + collection burst
	pass

func change_state(new_state: State):
	current_state = new_state
	# TODO: show/hide scene layers based on state
