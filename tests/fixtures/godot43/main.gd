extends Node2D
func _ready():
 print("GODOT_FIXTURE_READY")
 if OS.has_feature("web"):
  JavaScriptBridge.get_interface("document").body.setAttribute("data-godot-ready", "yes")
 queue_redraw()
func _draw():
 draw_rect(Rect2(8, 8, 160, 96), Color(0.1, 0.6, 0.4))
