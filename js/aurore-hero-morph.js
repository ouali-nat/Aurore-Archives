(function(){'use strict';function init(){const hero=document.querySelector('#screen-home .hero');if(!hero||hero.dataset.auroreHeroMorphReady==='1')return;hero.dataset.auroreHeroMorphReady='1';hero.classList.add('aurore-hero-morph');
function p(x,y){return Math.max(2,Math.min(98,x)).toFixed(2)+'% '+Math.max(2,Math.min(98,y)).toFixed(2)+'%'}
function poly(sides,round,rotation){const r=47,rad=rotation*Math.PI/180,v=[];for(let i=0;i<sides;i++){const a=rad+2*Math.PI*i/sides;v.push({x:50+r*Math.cos(a),y:50+r*Math.sin(a)})}const n=Math.max(1,Math.round(24/sides));const pts=[];for(let i=0;i<sides;i++){const a=v[(i+sides-1)%sides],c=v[i],b=v[(i+1)%sides],q={x:c.x+(a.x-c.x)*round,y:c.y+(a.y-c.y)*round},z={x:c.x+(b.x-c.x)*round,y:c.y+(b.y-c.y)*round};for(let j=0;j<n;j++){const t=j/n,m=1-t;pts.push(p(m*m*q.x+2*m*t*c.x+t*t*z.x,m*m*q.y+2*m*t*c.y+t*t*z.y))}}while(pts.length<24)pts.push(pts[pts.length-1]);return pts.slice(0,24).join(',')}
function bubbles(lobes,baseR,amp,width,rotation){const pts=[];for(let i=0;i<24;i++){const theta=rotation+i*(360/24),rad=theta*Math.PI/180;let bump=0;for(let L=0;L<lobes;L++){const lobeAngle=rotation+L*(360/lobes);let diff=((theta-lobeAngle+540)%360)-180;bump+=Math.exp(-(diff*diff)/(2*width*width))}const r=baseR+amp*bump;pts.push(p(50+r*Math.cos(rad),50+r*Math.sin(rad)))}return pts.join(',')}
const shapes=[
  {name:'circle',gen:function(){return poly(24,0,-90)}},
  {name:'triangle',gen:function(){return poly(3,.24,-90)}},
  {name:'square',gen:function(){return poly(4,.22,-45)}},
  {name:'cube',gen:function(){return poly(4,.12,-45)}},
  {name:'hexagon',gen:function(){return poly(6,.18,-90)}},
  {name:'octagon',gen:function(){return poly(8,.15,-90)}},
  {name:'dodecagon',gen:function(){return poly(12,.11,-90)}},
  {name:'polygon24',gen:function(){return poly(24,0,-90)}},
  {name:'drop',gen:function(){return poly(3,.28,-90)}},
  {name:'leaf',gen:function(){return poly(4,.42,-18)}},
  {name:'bubbles3',gen:function(){return bubbles(3,30,17,26,-90)}},
  {name:'bubbles5',gen:function(){return bubbles(5,32,13,20,-90)}},
  {name:'bubbles7',gen:function(){return bubbles(7,34,10,15,0)}}
];
let index=0,timer=0;const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
function apply(){const s=shapes[index];hero.dataset.shape=s.name;hero.style.setProperty('--hero-clip','polygon('+s.gen()+')');index=(index+1)%shapes.length}
function schedule(){clearTimeout(timer);if(reduce.matches||document.hidden)return;timer=setTimeout(function(){apply();schedule()},3000)}
apply();index=0;schedule();document.addEventListener('visibilitychange',schedule);if(reduce.addEventListener)reduce.addEventListener('change',schedule)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()})();
