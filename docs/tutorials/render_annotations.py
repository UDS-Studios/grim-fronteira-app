"""Regenerate annotated PNGs and editable SVGs from unchanged browser captures."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json, base64, html, math, textwrap

ROOT=Path(__file__).resolve().parent
FONT_ROOT=Path('/usr/share/fonts/truetype/dejavu')
def font(n,bold=False):
    return ImageFont.truetype(str(FONT_ROOT/('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')),n)
INK='#332a22'; RUST='#95462e'; PAPER='#faf5e9'; OLIVE='#535b42'; BRASS='#9b793c'
records=json.loads((ROOT/'captures.json').read_text())
# The custom-name field was below the viewport. Only point at the visible name.
for r in records:
    if r['role']=='player' and r['num']==3:
        r['marks']=r['marks'][:1]
        r['caption']='Click a suggested name. To write your own instead, scroll to the custom-name field, enter the name, and click Submit.'

for role in ['marshal','player']:
    out=ROOT/(role+'-tutorial')
    steps=[r for r in records if r['role']==role]
    (out/'annotations'/'steps.json').write_text(json.dumps(steps,indent=2))
    readme=[f'# Grim Fronteira - {role.title()} Tutorial','',
        'Real screenshots from a local production build. Game app source files were not changed.',
        '', '**Branch:** feature/post-deploy-polish',
        '**Commit:** d2592b2731ba0919ed7dd2950be64947bc17e349',
        '**Captured:** 5 October 2026',
        '**Capture size:** 1280 x 720 CSS pixels (browser default).',
        '', '## Reading order','']
    for r in steps:
        shot=out/'originals'/(r['filename']+'.jpg')
        im=Image.open(shot).convert('RGB')
        sw,sh=im.size; pad=40; sy=116; w=sw+2*pad
        lines=textwrap.wrap(r['caption'],width=100,break_long_words=False)
        foot_y=sy+sh+27; height=foot_y+len(lines)*31+65
        canvas=Image.new('RGB',(w,height),PAPER); draw=ImageDraw.Draw(canvas)
        rolelabel=f'{role.upper()} TUTORIAL'
        draw.text((pad,22),rolelabel,font=font(14,True),fill=OLIVE)
        draw.text((pad,48),r['title'],font=font(30,True),fill=INK)
        step_label=f"{r['num']:02d} / {len(steps):02d}"
        draw.text((w-pad-draw.textlength(step_label,font=font(18,True)),26),step_label,font=font(18,True),fill=RUST)
        draw.line((pad,99,w-pad,99),fill=BRASS,width=2)
        canvas.paste(im,(pad,sy))
        draw.rectangle((pad-1,sy-1,pad+sw,sy+sh),outline=BRASS,width=1)
        b64=base64.b64encode(shot.read_bytes()).decode()
        svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{height}" viewBox="0 0 {w} {height}">',
          f'<rect width="100%" height="100%" fill="{PAPER}"/>',
          f'<g font-family="DejaVu Sans, sans-serif"><text x="40" y="36" font-size="14" font-weight="bold" fill="{OLIVE}">{rolelabel}</text>',
          f'<text x="40" y="78" font-size="30" font-weight="bold" fill="{INK}">{html.escape(r["title"])}</text>',
          f'<text x="{w-40}" y="44" text-anchor="end" font-size="18" font-weight="bold" fill="{RUST}">{step_label}</text>',
          f'<path d="M40 99 H{w-40}" stroke="{BRASS}" stroke-width="2"/>',
          f'<image x="{pad}" y="{sy}" width="{sw}" height="{sh}" href="data:image/jpeg;base64,{b64}"/>']
        for i,m in enumerate(r['marks'],1):
            assert m['x']>=0 and m['y']>=0 and m['x']+m['width']<=sw+1 and m['y']+m['height']<=sh+1,(r,m)
            x=pad+m['x']-5; y=sy+m['y']-5; bw=m['width']+10; bh=m['height']+10
            draw.rounded_rectangle((x,y,x+bw,y+bh),radius=9,outline=RUST,width=4)
            svg.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="9" fill="none" stroke="{RUST}" stroke-width="4"/>')
            # Short arrows end on the highlight border, not on a control label.
            right=m['x']+m['width']/2>sw/2
            cx=min(w-22,x+bw+40) if right else max(22,x-40)
            cy=max(sy+20,y-23)
            end=(x+bw+3,y+min(35,bh/2)) if right else (x-3,y+min(35,bh/2))
            vec=(end[0]-cx,end[1]-cy); length=math.hypot(*vec); ux,uy=vec[0]/length,vec[1]/length
            start=(cx+ux*18,cy+uy*18)
            tip=end
            a=(tip[0]-ux*13-uy*6,tip[1]-uy*13+ux*6)
            b=(tip[0]-ux*13+uy*6,tip[1]-uy*13-ux*6)
            draw.line((*start,*tip),fill=RUST,width=4);draw.polygon((tip,a,b),fill=RUST)
            draw.ellipse((cx-18,cy-18,cx+18,cy+18),fill=RUST,outline=PAPER,width=2)
            text=str(i);draw.text((cx-draw.textlength(text,font=font(19,True))/2,cy-12),text,font=font(19,True),fill='white')
            svg.extend([f'<path d="M{start[0]} {start[1]} L{tip[0]} {tip[1]}" fill="none" stroke="{RUST}" stroke-width="4"/>',
             f'<polygon points="{tip[0]},{tip[1]} {a[0]},{a[1]} {b[0]},{b[1]}" fill="{RUST}"/>',
             f'<circle cx="{cx}" cy="{cy}" r="18" fill="{RUST}" stroke="{PAPER}" stroke-width="2"/>',
             f'<text x="{cx}" y="{cy+7}" text-anchor="middle" font-size="19" font-weight="bold" fill="white">{i}</text>'])
        for i,line in enumerate(lines):
            draw.text((pad,foot_y+i*31),line,font=font(22),fill=INK)
            svg.append(f'<text x="{pad}" y="{foot_y+i*31+22}" font-size="22" fill="{INK}">{html.escape(line)}</text>')
        footer='GRIM FRONTEIRA  /  '+('FIRST GAME' if role=='marshal' else 'JOIN AND PLAY')
        draw.text((pad,height-30),footer,font=font(12,True),fill=OLIVE)
        svg.append(f'<text x="40" y="{height-18}" font-size="12" font-weight="bold" fill="{OLIVE}">{footer}</text></g></svg>')
        canvas.save(out/'images'/(r['filename']+'.png'),optimize=True)
        (out/'annotations'/(r['filename']+'.svg')).write_text('\n'.join(svg))
        readme.extend([f"### {r['num']:02d}. {r['title']}",'',f"![{r['title']}](images/{r['filename']}.png)",'',r['caption'],''])
    readme.extend(['## Editing and regeneration','',
       'Edit the corresponding record in ../captures.json and run ../render_annotations.py with Python 3 and Pillow. The script regenerates PNGs, editable self-contained SVGs, steps.json, and this reading-order guide. Original screenshots remain unchanged.',
       '','## Scope and verified flow','',
       'Verified through an ordinary two-player scene, player acknowledgments, Close Scene, Reward distribution, and New Scene. The UI automatically marks a character ready after name and feature selection.',
       '','Healing, excess-Reward discards, detailed Azzardo and Dark play, and the other faction powers are not illustrated as separate walkthroughs. They are advanced follow-ups. The final Player screenshot shows the successful second player (Abner), while most earlier Player screenshots follow Leonor. The faction screenshot is an optional example: its selection was cancelled before ordinary play continued.',
       '', 'These are local disposable sample games. No invitations were sent, no source files were changed, and nothing was committed or deployed.'])
    (out/'README.md').write_text('\n'.join(readme))
    # Two-column review sheets retain enough detail to spot annotation errors.
    for group_start in range(0,len(steps),6):
        group=steps[group_start:group_start+6]
        thumbnails=[]
        for r in group:
            image=Image.open(out/'images'/(r['filename']+'.png'))
            image.thumbnail((680,540))
            thumbnails.append(image)
        sheet=Image.new('RGB',(1400,570*((len(group)+1)//2)), '#e0d9ca')
        for i,image in enumerate(thumbnails):sheet.paste(image,(20+(i%2)*700,15+(i//2)*570))
        sheet.save(out/f'review-{group_start//6+1}.jpg',quality=92)
    print(role,len(steps),'images generated')
