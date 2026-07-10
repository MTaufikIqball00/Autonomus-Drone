import re
with open('/home/iqball/PX4-Autopilot/Tools/simulation/gz/worlds/agricultural_field.sdf', 'r') as f:
    content = f.read()

content = content.replace('<metal>', '<metal>\n                <metalness>0</metalness>')

# Also, there are <metal> tags in the water material which already have <metalness>0.1</metalness>.
# Wait! This will add a second <metalness>0</metalness> if it already exists.
# Let's fix that.
content = re.sub(r'<metalness>0</metalness>\s*<roughness>', '<roughness>', content)
content = re.sub(r'<metalness>0</metalness>\s*<metalness>0.1</metalness>', '<metalness>0.1</metalness>', content)

with open('/home/iqball/PX4-Autopilot/Tools/simulation/gz/worlds/agricultural_field.sdf', 'w') as f:
    f.write(content)
