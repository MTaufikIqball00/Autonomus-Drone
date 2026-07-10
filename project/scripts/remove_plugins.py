import re
with open('/home/iqball/PX4-Autopilot/Tools/simulation/gz/worlds/agricultural_field.sdf', 'r') as f:
    content = f.read()

# Remove everything between <!-- PLUGINS ... and <!-- SCENE ...
content = re.sub(r'<!-- ===*[\s]*PLUGINS.*?<!-- ===*[\s]*SCENE', '<!-- ======================================================\n         SCENE', content, flags=re.DOTALL)

with open('/home/iqball/PX4-Autopilot/Tools/simulation/gz/worlds/agricultural_field.sdf', 'w') as f:
    f.write(content)
