"""Regenerate screenshot-only PNGs/SVGs with arrows and numbered callouts.
Titles and instructions remain editable in captures.json and steps.json.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse, json, base64, math

ROOT=Path(__file__).resolve().parent
FONT_ROOT=Path('/usr/share/fonts/truetype/dejavu')
def font(n,bold=False):
    return ImageFont.truetype(str(FONT_ROOT/('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')),n)
INK='#332a22'; RUST='#95462e'; PAPER='#faf5e9'; OLIVE='#535b42'; BRASS='#9b793c'
records=json.loads((ROOT/'captures.json').read_text())
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--metadata-only', action='store_true', help='Update steps.json and READMEs without modifying PNGs, SVGs, or review sheets.')
parser.add_argument('--role', choices=['marshal','player'], help='Regenerate only this role.')
parser.add_argument('--from-step', type=int, default=1, help='Leave earlier image and SVG files untouched.')
args=parser.parse_args()

for role in ([args.role] if args.role else ['marshal','player']):
    out=ROOT/(role+'-tutorial')
    steps=[r for r in records if r['role']==role]
    (out/'annotations'/'steps.json').write_text(json.dumps(steps,indent=2))
    readme=[f'# Grim Fronteira - {role.title()} Tutorial','',
        'Screenshots of the actual game interface. Captions and numbered callouts explain the controls.',
        '', '**Branch:** feature/post-deploy-polish',
        '**Commit:** d2592b2731ba0919ed7dd2950be64947bc17e349',
        '**Captured:** 5 October 2026',
        '**Capture size:** 1280 x 720 CSS pixels (browser default).',
        '', '## Reading order','']
    if role == 'marshal' and len(steps) > 12:
        readme[readme.index('## Reading order'):readme.index('## Reading order')] = ['**Advanced pages 13–16:** captured 19 October 2026 on feature/marshal-advanced-tutorial, using the real TableRouterView and engine-generated isolated sample states. No live games or player credentials were used.', '']
    for r in steps:
        readme.extend([f"### {r['num']:02d}. {r['title']}",'',f"![{r['title']}](images/{r['filename']}.png)",'',r['caption'],''])
        if args.metadata_only or r['num'] < args.from_step:
            continue
        shot=out/'originals'/(r['filename']+'.png')
        if not shot.exists():
            shot=shot.with_suffix('.jpg')
        mime='image/png' if shot.suffix == '.png' else 'image/jpeg'
        im=Image.open(shot).convert('RGB')
        sw,sh=im.size; pad=20; sy=20; w=sw+2*pad; height=sh+2*pad
        canvas=Image.new('RGB',(w,height),PAPER); draw=ImageDraw.Draw(canvas)
        canvas.paste(im,(pad,sy))
        draw.rectangle((pad-1,sy-1,pad+sw,sy+sh),outline=BRASS,width=1)
        b64=base64.b64encode(shot.read_bytes()).decode()
        svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{height}" viewBox="0 0 {w} {height}">',
          f'<rect width="100%" height="100%" fill="{PAPER}"/>',
          '<g font-family="DejaVu Sans, sans-serif">',
          f'<image x="{pad}" y="{sy}" width="{sw}" height="{sh}" href="data:{mime};base64,{b64}"/>']
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
        svg.append('</g></svg>')
        canvas.save(out/'images'/(r['filename']+'.png'),optimize=True)
        (out/'annotations'/(r['filename']+'.svg')).write_text('\n'.join(svg))
    readme.extend(['## Editing and regeneration','',
       'Edit the corresponding record in ../captures.json and run ../render_annotations.py with Python 3 and Pillow. The script regenerates PNGs, editable self-contained SVGs, steps.json, and this reading-order guide. Original screenshots remain unchanged.',
       'Use --metadata-only to update steps.json and this README without modifying any images. Numbered markers follow the marks array order, starting at 1. Titles and captions stay outside the PNGs and SVGs.',
       '','## Scope and verified flow','',
       'Verified through an ordinary two-player scene, player acknowledgments, Close Scene, Reward distribution, and New Scene. The UI automatically marks a character ready after name and feature selection.',
       '',('Marshal pages 13–16 cover Azzardo setup and resolution, Dark declaration, hidden-hand management, reveal timing, double Rewards and failure consequences. Healing, excess-Reward selection and other faction powers remain advanced follow-ups.' if role == 'marshal' and len(steps) > 12 else 'Detailed Azzardo and Dark controls are covered in the Marshal tutorial. The Player guide follows an ordinary scene; its final screenshot shows successful player Abner, while most earlier screenshots follow Leonor. The faction screenshot is an optional example: its selection was cancelled before ordinary play continued.'),
       '', 'These are isolated local sample states. No invitations were sent and no live game or deployment was changed.'])
    (out/'README.md').write_text('\n'.join(readme))
    if args.metadata_only:
        print(role,len(steps),'steps updated; images unchanged')
        continue
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
