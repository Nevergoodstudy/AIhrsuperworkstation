// Deterministic compositor for screenshots from the real application.
export async function installRenderer({assets}) {
  const W=1280,H=900,c=document.createElement('canvas');c.width=W;c.height=H;document.body.replaceChildren(c);
  const ctx=c.getContext('2d',{alpha:false}),images={};
  for(const [key,src] of Object.entries(assets)) images[key]=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});
  await document.fonts.ready;
  const C={bg:'#071b17',pine:'#173d33',mint:'#b9f4d1',lime:'#d8f277',paper:'#f1eddc',muted:'#9bb8ac'};
  const ease=p=>{p=Math.max(0,Math.min(1,p));return p*p*(3-2*p);};
  function text(s,x,y,size,color,weight=400,align='left'){ctx.font=weight+' '+size+'px PingFang SC, Microsoft YaHei, sans-serif';ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(s,x,y);}
  function rect(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
  function cursor(x,y,pulse){
    ctx.save();ctx.translate(x+40,y+168);
    if(pulse>0){ctx.globalAlpha=(1-pulse)*0.65;ctx.beginPath();ctx.arc(0,0,8+pulse*25,0,2*Math.PI);ctx.strokeStyle=C.lime;ctx.lineWidth=3;ctx.stroke();ctx.globalAlpha=1;}
    ctx.shadowColor=C.bg;ctx.shadowBlur=4;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,23);ctx.lineTo(6,17);ctx.lineTo(11,28);ctx.lineTo(16,25);ctx.lineTo(11,15);ctx.lineTo(21,15);ctx.closePath();ctx.fillStyle=C.paper;ctx.fill();ctx.strokeStyle=C.bg;ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
  }
  function highlight(box,phase){
    if(!box)return;const x=Math.max(42,box.x+36),y=Math.max(170,box.y+164),w=Math.min(box.width+8,1236-x),h=Math.min(box.height+8,815-y);if(w<4||h<4)return;
    ctx.save();ctx.strokeStyle='#168371';ctx.lineWidth=2.5;ctx.shadowColor=C.lime;ctx.shadowBlur=7;ctx.globalAlpha=0.68+0.26*Math.sin(phase*Math.PI);ctx.beginPath();ctx.roundRect(x,y,w,h,5);ctx.stroke();ctx.restore();
  }
  function intro(t,shot){
    const g=ctx.createRadialGradient(890,440,40,660,450,840);g.addColorStop(0,C.pine);g.addColorStop(1,C.bg);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.strokeStyle='#26463a';ctx.lineWidth=1;
    for(let x=40;x<W;x+=60){ctx.beginPath();ctx.moveTo(x,160);ctx.lineTo(x,765);ctx.stroke();}
    for(let y=165;y<800;y+=60){ctx.beginPath();ctx.moveTo(40,y);ctx.lineTo(1240,y);ctx.stroke();}
    text('TalentDesk',62,83,27,C.mint,650);text('招聘工作台  /  FEATURE TOUR',62,119,14,C.muted);text('界面实录 · 虚构演示数据',1218,83,15,C.muted,400,'right');
    const a=ease(t/0.5);ctx.save();ctx.globalAlpha=Math.max(0.5,a);text(shot.title,640,337+(1-a)*16,60,C.paper,600,'center');text(shot.subtitle,640,399+(1-a)*10,23,C.muted,400,'center');ctx.restore();
    const labels=['岗位要求','简历证据','独立测评','人工复核','反馈发布'],chars=['岗','证','答','审','达'];
    for(let i=0;i<5;i++){const x=180+i*230;if(i<4){ctx.strokeStyle='#527361';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+44,540);ctx.lineTo(x+186,540);ctx.stroke();ctx.beginPath();ctx.moveTo(x+178,535);ctx.lineTo(x+186,540);ctx.lineTo(x+178,545);ctx.stroke();const p=(t*0.7-i*0.13+2)%1;ctx.beginPath();ctx.arc(x+44+p*142,540,4,0,2*Math.PI);ctx.fillStyle=C.lime;ctx.fill();}ctx.beginPath();ctx.arc(x,540,34,0,2*Math.PI);const active=i===Math.floor(t*1.5)%5;ctx.fillStyle=active?C.lime:'#244b3c';ctx.fill();text(chars[i],x,552,27,active?C.bg:C.mint,550,'center');text(labels[i],x,617,22,C.paper,500,'center');}
    rect(428,700,424,48,24,C.pine,'#446c58');text('整理交给工具，判断留给人。',640,732,20,C.mint,500,'center');text(shot.outro?'AI 为可选证据整理服务；正式环境仍需部署验收。':'真实界面分步演示 · 不含真实候选人资料',640,845,16,C.muted,400,'center');
  }
  window.renderFeatureFrame=({shot,previous,localTime,globalTime,totalTime,segmentIndex,segmentCount})=>{
    ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,H);if(shot.intro){intro(localTime,shot);return;}
    text('TALENTDESK  /  '+String(shot.chapter).padStart(2,'0'),40,34,13,C.mint,600);text('界面实录 · 虚构演示数据',1240,34,14,C.muted,400,'right');text(shot.title,40,84,34,C.paper,600);text(shot.subtitle,40,117,17,C.muted);text('TalentDesk',1240,85,24,C.mint,650,'right');
    rect(39,137,1202,682,10,'#eaf0ec','#466050');rect(40,138,1200,32,[9,9,0,0],'#e8efea');for(const [i,color] of ['#b1c2b5','#c4d1c7','#a3b9ab'].entries()){ctx.beginPath();ctx.arc(58+i*17,153,4,0,2*Math.PI);ctx.fillStyle=color;ctx.fill();}text(shot.role+' · 本机隔离演示',640,158,12,'#5b7363',450,'center');
    ctx.save();ctx.beginPath();ctx.roundRect(40,168,1200,650,[0,0,8,8]);ctx.clip();if(previous?.asset&&localTime<0.26)ctx.drawImage(images[previous.asset],40,168,1200,650);ctx.globalAlpha=previous?.asset?ease(localTime/0.26):1;ctx.drawImage(images[shot.asset],40,168,1200,650);ctx.globalAlpha=1;ctx.restore();
    if(localTime>0.25)highlight(shot.box,Math.min(localTime/2,1));if(shot.cursor){const from=previous?.cursor||{x:shot.cursor.x+75,y:Math.min(620,shot.cursor.y+45)},p=ease(localTime/0.6);cursor(from.x+(shot.cursor.x-from.x)*p,from.y+(shot.cursor.y-from.y)*p,localTime>0.6&&localTime<1.25?(localTime-0.6)/0.65:0);}
    ctx.fillStyle=C.lime;ctx.fillRect(40,843,4,20);text(shot.caption,57,860,18,C.paper,500);const dx=1240-segmentCount*14;for(let i=0;i<segmentCount;i++)rect(dx+i*14,848,i===segmentIndex?9:5,5,3,i===segmentIndex?C.lime:'#496557');ctx.fillStyle='#1b3d30';ctx.fillRect(40,883,1200,2);ctx.fillStyle=C.mint;ctx.fillRect(40,883,1200*globalTime/totalTime,2);
  };
}
