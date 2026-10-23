"""Inventoried pose sheets from the headless decoded-asset renders (no image generation)."""
import json,pathlib,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
root=pathlib.Path(sys.argv[1]);font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',13);large=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',18)
def bbox(im):
 a=np.array(im.convert('RGB')).astype(float);bg=a[3,3];mask=np.linalg.norm(a-bg,axis=2)>30;y,x=np.nonzero(mask)
 return (max(0,int(x.min())-10),max(0,int(y.min())-10),min(im.width,int(x.max())+11),min(im.height,int(y.max())+11))
for folder in root.iterdir():
 if not (folder/'frames.json').exists():continue
 manifest=json.load(open(folder/'frames.json'));cells=[];sheet=Image.new('RGB',(1440,390),'#0b1722');draw=ImageDraw.Draw(sheet)
 for i,row in enumerate(manifest['frames']):
  im=Image.open(folder/row['file']).convert('RGB');crop=bbox(im);im=im.crop(crop);ratio=min(232/im.width,302/im.height);im=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS);sheet.paste(im,(i*240+(240-im.width)//2,52+(302-im.height)//2))
  draw.text((i*240+5,5),f"{i+1}. {row['clip']}\n{row['seconds']:.3f}s",font=font,fill='white');draw.text((i*240+5,362),'ORIGINAL 4W' if i==5 else 'PACKED 2W',font=font,fill='#62dde8');cells.append({**row,'cell':i+1,'crop':crop})
 sheet.save(folder/'pose-sheet.jpg',quality=94)
 ims=[Image.open(folder/manifest['frames'][i]['file']).convert('RGB') for i in [4,5]];boxes=[bbox(im)for im in ims];box=(min(b[0]for b in boxes),min(b[1]for b in boxes),max(b[2]for b in boxes),max(b[3]for b in boxes));pair=Image.new('RGB',(960,640),'#0b1722');d=ImageDraw.Draw(pair)
 for i,im in enumerate(ims):
  im=im.crop(box);ratio=min(460/im.width,530/im.height);im=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS);pair.paste(im,(i*480+(480-im.width)//2,86+(530-im.height)//2));d.text((i*480+12,14),f"{manifest['bot'].upper()} · {'PACKED 2 WEIGHTS' if i==0 else 'ORIGINAL WEIGHTS'}\n{manifest['frames'][4]['clip']} @ {manifest['frames'][4]['seconds']:.3f}s",font=large,fill='white')
 d.text((12,618),f"Same pose/camera. Largest sampled vertex change: {manifest['frames'][5]['clampMaxMm']:.1f} mm. Workbench proof.",font=font,fill='#62dde8');pair.save(folder/'worst-pair.jpg',quality=95)
 (folder/'sheet-inventory.json').write_text(json.dumps({'sheet':'pose-sheet.jpg','cells':cells,'worstPair':{'file':'worst-pair.jpg','cells':[5,6],'sharedCrop':box}},indent=2)+'\n')
