import re
with open('/home/iqball/PX4-Autopilot/Tools/simulation/gz/worlds/agricultural_field.sdf', 'r') as f:
    content = f.read()
# Find all <material> blocks
def cleanup_material(match):
    block = match.group(0)
    # If it has more than one <ambient>, remove the first one(s) (which are the 1 1 1 1 ones I just added)
    block = re.sub(r'\s*<ambient>1 1 1 1</ambient>\s*<diffuse>1 1 1 1</diffuse>\s*<specular>1 1 1 1</specular>', '', block)
    # Wait, for the PBR materials, I WANT the 1 1 1 1 ones.
    # But for water, I don't want them.
    # The water materials have <ambient>0.X ...</ambient>
    return block

# Better logic: If a material block has multiple <ambient>, keep the LAST one.
def keep_last_tags(match):
    block = match.group(0)
    
    ambient_tags = re.findall(r'<ambient>.*?</ambient>', block)
    if len(ambient_tags) > 1:
        # Remove all but the last
        for tag in ambient_tags[:-1]:
            block = block.replace(tag, '', 1)
            
    diffuse_tags = re.findall(r'<diffuse>.*?</diffuse>', block)
    if len(diffuse_tags) > 1:
        # Remove all but the last
        for tag in diffuse_tags[:-1]:
            block = block.replace(tag, '', 1)
            
    specular_tags = re.findall(r'<specular>.*?</specular>', block)
    if len(specular_tags) > 1:
        # Remove all but the last
        for tag in specular_tags[:-1]:
            block = block.replace(tag, '', 1)
            
    return block

content = re.sub(r'<material>.*?</material>', keep_last_tags, content, flags=re.DOTALL)
with open('/home/iqball/PX4-Autopilot/Tools/simulation/gz/worlds/agricultural_field.sdf', 'w') as f:
    f.write(content)
