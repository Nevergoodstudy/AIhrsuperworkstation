/* 《简历之后》主播放器。图形、字幕与声音均在本地生成。 */
(() => {
  'use strict';
  const DURATION=96, SCENE=12, W=1920, H=1080;
  const $=id=>document.getElementById(id);
  const canvas=$('film'),ctx=canvas.getContext('2d',{alpha:false});
  const chapters=[
    {name:'简历与判断',title:'简历，能替你做决定吗？',caption:['一页简历，装得下多少经历？','项目、年限，还有熟悉的工具。','这些描述，是认识一个人的起点。','但下一份工作，需要怎样的能力？']},
    {name:'经历与证据',title:'经历，是线索。',caption:['写过什么，不等于现在会怎么做。','把工作中的问题，变成一道真实任务。','看见候选人如何拆解，又如何选择。','让经历，接上可以观察的证据。']},
    {name:'观察的尺度',title:'先约定，什么叫做好。',caption:['出题之前，先约定观察什么。','问题怎么拆，方案如何取舍。','再看思路，能不能被清楚说明。','把评分要点写下来，让复核有据可依。']},
    {name:'任务中作答',title:'让能力，发生在任务里。',caption:['一条专属邀请，连接候选人与任务。','在规定时间里，写下自己的解法。','作答过程可以保存，再正式提交。','留下答案，也留下可以复核的思路。']},
    {name:'结论的出处',title:'让每个结论，都有出处。',caption:['有了答案，还要找得到判断的依据。','AI 可以辅助整理原文中的线索。','回到答卷，检查证据与结论是否相符。','整理交给工具，判断留给人。']},
    {name:'共同复核',title:'一次判断，需要共同复核。',caption:['同一份答卷，让不同复核人独立阅读。','沿着逐题记录，比较各自的理由。','由 HR 汇总，再决定发布什么反馈。','重要的判断，应该能够被共同复核。']},
    {name:'业务的托付',title:'业务能运行，也要能托付。',caption:['进入业务使用，还要守住信息边界。','让不同角色，只在授权范围内操作。','记录关键动作，也准备备份与恢复。','能操作，还要能追溯、能恢复。']},
    {name:'简历之后',title:'简历之后',caption:['从岗位、简历，到任务与人工复核。','再把判断，带回清楚的反馈。','TalentDesk 招聘工作台。','简历之后，你准备看见什么？']}
  ];
  const colors={ink:'#071b17',mint:'#b9f4d1',paper:'#f1eddc',muted:'#8fa99d',gold:'#e4c18d'};
  const serif='"Songti SC","Noto Serif SC",serif',sans='"PingFang SC","Microsoft YaHei",sans-serif';
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const smooth=v=>{v=clamp(v);return v*v*(3-2*v)};
  const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453123;return v-Math.floor(v)};
  const fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(Math.floor(n%60)).padStart(2,'0');
  let time=clamp(Number(new URLSearchParams(location.search).get('t'))||0,0,DURATION);
  let playing=false,muted=false,subtitles=true,used=false;
  let previousRAF=0,raf=0,lastScene=-1,lastCue=-1,uiTick=-1;
  let audioCtx=null,audioBuffer=null,audioSource=null,master=null,cursorTimer=0;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chapterButtons=chapters.map((item,index)=>{
    const button=document.createElement('button');button.type='button';button.className='chapter';
    const stamp=document.createElement('small');stamp.textContent=fmt(index*SCENE);
    const label=document.createElement('span');label.textContent=item.name;
    button.append(stamp,label);button.setAttribute('aria-label','跳转至'+fmt(index*SCENE)+'，'+item.name);
    button.addEventListener('click',()=>{seek(index*SCENE);$('screen').focus({preventScroll:true})});
    $('chapters').append(button);return button;
  });
  chapters.forEach((item,index)=>{
    const section=document.createElement('section'),heading=document.createElement('h2'),p=document.createElement('p');
    heading.textContent=fmt(index*SCENE)+'　'+item.name;p.textContent=item.caption.join('');section.append(heading,p);$('transcript').append(section);
  });
  const note=document.createElement('p');note.className='note';note.textContent='本片以原创图形讲解 TalentDesk 的招聘流程，所有图示均为流程示意，不含真实候选人信息。项目仍需正式环境部署与业务验收。AI 为可选辅助能力，录用判断由人作出。当前版本为字幕与配乐，无人声旁白。配乐由本页程序原创生成。参考来源与制作记录见项目 media/after-the-resume/README.md。';$('transcript').append(note);

  function background(t){
    ctx.fillStyle=colors.ink;ctx.fillRect(0,0,W,H);
    const glow=ctx.createRadialGradient(980+Math.sin(t*.055)*160,480,40,960,440,1180);
    glow.addColorStop(0,'#143b2f');glow.addColorStop(.55,'#0b251e');glow.addColorStop(1,colors.ink);
    ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);ctx.save();
    for(let i=0;i<48;i++){
      const x=hash(i*3+2)*W+Math.sin(t*.09+i)*8,y=(hash(i*3+3)*H-t*(2+hash(i)*4)+H*10)%H;
      ctx.globalAlpha=.06+hash(i+28)*.13;ctx.fillStyle=i%5===0?colors.gold:colors.mint;
      ctx.beginPath();ctx.arc(x,y,hash(i+100)*1.5+.5,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=.035;ctx.strokeStyle=colors.mint;ctx.lineWidth=1;
    for(let x=110;x<=1810;x+=85){ctx.beginPath();ctx.moveTo(x,291);ctx.lineTo(x,811);ctx.stroke()}
    for(let y=301;y<=811;y+=85){ctx.beginPath();ctx.moveTo(110,y);ctx.lineTo(1810,y);ctx.stroke()}
    ctx.restore();
  }
  function drawScene(index,local,t,alpha=1,offset=0){
    ctx.save();ctx.globalAlpha=alpha;ctx.translate(offset,0);
    if(index<7){
      ctx.fillStyle=colors.muted;ctx.font='500 27px '+sans;
      ctx.fillText(String(index+1).padStart(2,'0')+'  /  '+chapters[index].name,110,85);
      const intro=index===0?1:smooth((local+.05)/.7);
      ctx.save();ctx.globalAlpha*=intro;ctx.translate(0,(1-intro)*13);
      ctx.fillStyle=colors.paper;ctx.font='500 70px '+serif;ctx.fillText(chapters[index].title,110,190);ctx.restore();
    }
    window.TalentFilmArt.draw(ctx,index,Math.max(0,local),t);ctx.restore();
  }
  function caption(t){
    if(!subtitles)return;
    const index=Math.min(7,Math.floor(t/SCENE)),local=Math.min(11.999,t-index*SCENE);
    const cue=Math.min(3,Math.floor(local/3)),within=local%3;
    let a=smooth(within/.16)*smooth((3-within)/.16);if(t===0||t>=95.75)a=1;
    ctx.save();ctx.globalAlpha=a;
    const shade=ctx.createLinearGradient(0,845,0,1080);shade.addColorStop(0,'#071b1700');shade.addColorStop(.6,'#071b17c9');shade.addColorStop(1,'#071b17ed');
    ctx.fillStyle=shade;ctx.fillRect(0,845,W,235);
    ctx.strokeStyle='#8fa99d42';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(110,881);ctx.lineTo(1810,881);ctx.stroke();
    ctx.fillStyle=colors.paper;ctx.textAlign='center';ctx.font='500 46px '+sans;
    ctx.fillText(chapters[index].caption[cue],960,970);ctx.restore();
  }
  function render(t){
    t=clamp(t,0,DURATION);ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;background(t);
    const index=Math.min(7,Math.floor(t/SCENE)),local=t-index*SCENE;
    if(index>0&&local<.36){
      const p=smooth(local/.36);drawScene(index-1,SCENE-.001,t,1-p,-p*45);drawScene(index,local,t,p,(1-p)*45);
      ctx.save();ctx.globalAlpha=Math.sin(p*Math.PI)*.15;
      const x=-300+p*2520,sweep=ctx.createLinearGradient(x-150,0,x+150,0);
      sweep.addColorStop(0,'#b9f4d100');sweep.addColorStop(.5,'#b9f4d1');sweep.addColorStop(1,'#b9f4d100');
      ctx.fillStyle=sweep;ctx.fillRect(0,0,W,H);ctx.restore();
    }else{drawScene(index,Math.min(local,12),t)}
    caption(t);
  }
  function updateUI(force=false){
    const index=Math.min(7,Math.floor(time/SCENE)),cue=Math.min(3,Math.floor((time-index*SCENE)/3)),tick=Math.floor(time*10);
    if(force||tick!==uiTick){
      $('seek').value=time;$('seek').style.setProperty('--progress',time/DURATION*100+'%');$('now').textContent=fmt(time);
      $('seek').setAttribute('aria-valuetext',Math.floor(time/60)+'分'+Math.floor(time%60)+'秒，共1分36秒');uiTick=tick;
    }
    if(index!==lastScene||force){
      chapterButtons.forEach((button,i)=>button.setAttribute('aria-current',String(i===index)));
      $('sceneNumber').textContent=String(index+1).padStart(2,'0');$('sceneName').textContent=chapters[index].name;
      canvas.setAttribute('aria-label','《简历之后》第'+(index+1)+'幕：'+chapters[index].title);lastScene=index;lastCue=-1;
    }
    if(cue!==lastCue||force){$('spoken').textContent=chapters[index].caption[cue];lastCue=cue}
  }
  function audioStop(){if(audioSource){try{audioSource.stop()}catch{}audioSource.disconnect();audioSource=null}}
  function createScore(ac){
    const rate=22050,length=DURATION*rate,buffer=ac.createBuffer(2,length,rate);
    const left=buffer.getChannelData(0),right=buffer.getChannelData(1),TAU=Math.PI*2;
    const add=(start,duration,fn,pan=0)=>{
      const first=Math.floor(start*rate),end=Math.min(length,Math.floor((start+duration)*rate));
      const lg=Math.sqrt((1-pan)*.5),rg=Math.sqrt((1+pan)*.5);
      for(let i=Math.max(0,first);i<end;i++){const v=fn((i-first)/rate);left[i]+=v*lg;right[i]+=v*rg}
    };
    const chords=[
      [146.832,174.614,220,261.626,329.628],[116.541,146.832,174.614,220,261.626],
      [130.813,164.814,196,220,261.626],[130.813,164.814,196,233.082,293.665],
      [146.832,174.614,220,261.626,329.628],[116.541,146.832,174.614,220,293.665],
      [130.813,164.814,196,261.626,329.628],[146.832,174.614,220,293.665,329.628]
    ];
    // Original score: warm chords, quiet bells, and a restrained 80 BPM pulse.
    for(let c=0;c<8;c++){
      chords[c].forEach((freq,k)=>add(c*12,14,s=>{
        const e=Math.min(1,s/1.5)*Math.pow(clamp((14-s)/3.2),1.2);
        return e*.024*(Math.sin(TAU*freq*s)+.28*Math.sin(TAU*freq*1.0025*s)+.10*Math.sin(TAU*freq*2*s));
      },(k-2)*.2));
      const bass=chords[c][0]/2;add(c*12,12.7,s=>Math.sin(TAU*bass*s)*.047*Math.min(1,s/.4)*clamp((12.7-s)/1.5));
    }
    const motif=[0,2,4,2,1,3,4,2];
    for(let beat=0;beat<128;beat++){
      const at=beat*.75,ci=Math.min(7,Math.floor(at/12));
      if(beat%2===0||(beat%16>=12&&ci>1)){
        const pitch=chords[ci][motif[beat%8]]*2;
        const bell=s=>(Math.sin(TAU*pitch*s)+.19*Math.sin(TAU*pitch*2.003*s))*.038*Math.min(1,s/.008)*Math.exp(-s*3.4);
        const pan=Math.sin(beat*1.3)*.45;add(at,2.4,bell,pan);add(at+.375,2.4,s=>bell(s)*.27,-pan);add(at+.75,2.4,s=>bell(s)*.10,pan);
      }
      if(beat<112&&beat%4===0)add(at,.36,s=>Math.sin(TAU*(47*s+5*(1-Math.exp(-s*30))))*.08*Math.exp(-s*15)*Math.min(1,s/.003));
      if(beat>15&&beat<112&&beat%2===1)add(at+.375,.095,s=>{const n=Math.sin((Math.floor(s*rate)+beat*541)*12.9898)*43758.5453;return((n-Math.floor(n))*2-1)*.006*Math.exp(-s*65)},Math.sin(beat)*.45);
    }
    for(let i=0;i<length;i++){
      const t=i/rate,fade=Math.min(1,t/1.1,Math.max(0,(DURATION-t)/3));
      left[i]=Math.tanh(left[i]*1.4)*fade;right[i]=Math.tanh(right[i]*1.4)*fade;
    }return buffer;
  }
  async function ensureAudio(){
    if(muted)return;
    try{
      if(!audioCtx){const C=window.AudioContext||window.webkitAudioContext;if(!C)throw Error('audio unavailable');audioCtx=new C();master=audioCtx.createGain();master.gain.value=.8;master.connect(audioCtx.destination)}
      await audioCtx.resume();if(!audioBuffer)audioBuffer=createScore(audioCtx);if(playing&&!muted)audioStart();
    }catch{$('status').textContent='当前浏览器未启用配乐，画面仍可正常播放。'}
  }
  function audioStart(){
    audioStop();if(!audioCtx||!audioBuffer||muted||!playing||time>=DURATION)return;
    audioSource=audioCtx.createBufferSource();audioSource.buffer=audioBuffer;audioSource.connect(master);audioSource.start(0,time);
  }
  function frame(stamp){
    if(!playing)return;if(previousRAF)time=Math.min(DURATION,time+(stamp-previousRAF)/1000);previousRAF=stamp;render(time);updateUI();
    if(time>=DURATION){pause();$('status').textContent='短片已结束。可以重播，或选择一个章节再次观看。';$('startCue').hidden=true;return}raf=requestAnimationFrame(frame);
  }
  function refreshPlayButton(){
    $('playIcon').innerHTML=playing?'<path d="M8 4v16M16 4v16"/>':'<path d="m8 4 12 8-12 8z"/>';
    $('playLabel').textContent=playing?'暂停':time>=DURATION?'重播':'播放';
    $('play').setAttribute('aria-label',playing?'暂停短片，空格键':'播放短片，空格键');$('startCue').hidden=playing||used;
  }
  function play(){
    if(playing)return;if(time>=DURATION)time=0;playing=true;used=true;previousRAF=0;refreshPlayButton();
    $('status').textContent=muted?'播放中 · 配乐已关闭。':'播放中 · 原创程序配乐。';ensureAudio();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
  }
  function pause(){playing=false;cancelAnimationFrame(raf);previousRAF=0;audioStop();refreshPlayButton();render(time);updateUI(true)}
  function toggle(){if(playing){pause();$('status').textContent='已暂停。可拖动时间轴，或选择章节。'}else play()}
  function seek(target){
    time=clamp(Number(target)||0,0,DURATION);previousRAF=0;
    if(time>=DURATION&&playing)pause();else if(playing)audioStart();render(time);updateUI(true);refreshPlayButton();
  }
  function toggleSound(){
    muted=!muted;$('sound').setAttribute('aria-pressed',String(!muted));$('sound').setAttribute('aria-label',muted?'开启原创配乐':'关闭原创配乐');$('soundLabel').textContent=muted?'配乐关':'配乐开';
    $('soundIcon').innerHTML=muted?'<path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6m0-6-6 6"/>':'<path d="m11 4-6 5H2v6h3l6 5zM15 8c3 2 3 6 0 8M18 5c5 4 5 10 0 14"/>';
    if(muted)audioStop();else ensureAudio();$('status').textContent=muted?'配乐已关闭。':'原创配乐已开启，播放时响起。';
  }
  function toggleCaptions(){subtitles=!subtitles;$('captions').setAttribute('aria-pressed',String(subtitles));$('captions').setAttribute('aria-label',subtitles?'关闭字幕':'开启字幕');render(time)}
  async function fullScreen(){
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else if($('screen').requestFullscreen)await $('screen').requestFullscreen();
      else if($('screen').webkitRequestFullscreen)$('screen').webkitRequestFullscreen();
      else $('status').textContent='此浏览器不支持网页全屏，可使用浏览器的全屏模式。';
    }catch{$('status').textContent='全屏未开启，可使用浏览器的全屏模式。'}
  }
  $('play').addEventListener('click',toggle);$('screen').addEventListener('click',toggle);
  $('restart').addEventListener('click',()=>{seek(0);play()});$('seek').addEventListener('input',event=>seek(event.target.value));
  $('sound').addEventListener('click',toggleSound);$('captions').addEventListener('click',toggleCaptions);$('fullscreen').addEventListener('click',fullScreen);
  document.addEventListener('fullscreenchange',()=>$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'进入全屏'));
  $('screen').addEventListener('mousemove',()=>{clearTimeout(cursorTimer);$('screen').classList.add('show-cursor');cursorTimer=setTimeout(()=>$('screen').classList.remove('show-cursor'),1400)});
  document.addEventListener('keydown',event=>{
    const tag=event.target.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag)||event.target.isContentEditable||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.code==='Space'&&tag!=='BUTTON'&&tag!=='SUMMARY'){event.preventDefault();toggle()}
    else if(event.key==='ArrowRight'){event.preventDefault();seek(time+5)}else if(event.key==='ArrowLeft'){event.preventDefault();seek(time-5)}
    else if(event.key.toLowerCase()==='m')toggleSound();else if(event.key.toLowerCase()==='c')toggleCaptions();else if(event.key.toLowerCase()==='f')fullScreen();
    else if(event.key.toLowerCase()==='r'){seek(0);play()}else if(event.key==='Home'){event.preventDefault();seek(0)}else if(event.key==='End'){event.preventDefault();seek(DURATION)}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){pause();$('status').textContent='页面暂离，已为你暂停。返回后点击播放继续。'}});
  if(reduced)$('status').textContent='已按减少动态偏好暂停。准备好后点击播放；也可逐章阅读完整解说。';
  if(!window.TalentFilmArt){$('status').textContent='图形文件未加载，请使用同目录的完整 index.html。';return}
  window.TalentFilm=Object.freeze({duration:DURATION,chapters:chapters.map((s,i)=>({name:s.name,start:i*SCENE})),render,seek,play,pause,toggle,setMuted:value=>{if(Boolean(value)!==muted)toggleSound()},getState:()=>({time,playing,muted,subtitles,scene:Math.min(7,Math.floor(time/SCENE)),audioReady:Boolean(audioBuffer),audioState:audioCtx?audioCtx.state:'not-started'})});
  render(time);updateUI(true);document.documentElement.dataset.ready='true';document.fonts.ready.then(()=>render(time));
})();
