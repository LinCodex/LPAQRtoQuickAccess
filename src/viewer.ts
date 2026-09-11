import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const mount=document.getElementById('viewer')!,status=document.getElementById('status')!;
const scene=new THREE.Scene();scene.background=new THREE.Color('#eef0f4');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));mount.append(renderer.domElement);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;
const camera=new THREE.PerspectiveCamera(35,1,.001,20);camera.position.set(.22,.16,.42);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
const ktx=new KTX2Loader().setTranscoderPath('/decoders/basis/').detectSupport(renderer);
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx);
let current:THREE.Group|undefined,mixer:THREE.AnimationMixer|undefined,clip:THREE.AnimationClip|undefined,action:THREE.AnimationAction|undefined;
let revision=0;
const partSelect=document.createElement('select');partSelect.id='part';
const partLabel=document.createElement('label');partLabel.textContent='Inspect part';partLabel.append(partSelect);document.getElementById('progress')!.parentElement!.before(partLabel);
let parts:THREE.Object3D[]=[];
const normalToggle=document.createElement('input');normalToggle.type='checkbox';normalToggle.checked=true;normalToggle.id='normal-maps';normalToggle.style.width='auto';
const normalLabel=document.createElement('label');normalLabel.append(normalToggle,document.createTextNode(' Normal maps'));document.getElementById('background')!.parentElement!.after(normalLabel);
normalToggle.addEventListener('change',()=>current?.traverse(object=>{if(object instanceof THREE.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof THREE.MeshStandardMaterial)material.normalScale.setScalar(normalToggle.checked?1:0);}));
function frameObject(object:THREE.Object3D){
 const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(.40,.22,1).multiplyScalar(Math.max(size.x,size.y,size.z)*2.2));
 controls.update();
}
partSelect.addEventListener('change',()=>{
 for(const part of parts)part.visible=!partSelect.value||part.name===partSelect.value;
 const target=parts.find(part=>part.name===partSelect.value)??current;if(target)frameObject(target);
});
function dispose(group:THREE.Group){
 group.traverse(o=>{
  if(o instanceof THREE.Mesh){
   o.geometry.dispose();
   for(const mat of Array.isArray(o.material)?o.material:[o.material]){
    for(const value of Object.values(mat))if(value instanceof THREE.Texture)value.dispose();
    mat.dispose();
   }
  }
 });
}
async function load(name:string){
 const generation=++revision;status.textContent='Loading model…';
 try{
  const gltf=await loader.loadAsync(`/models/${name}.glb`);if(generation!==revision){dispose(gltf.scene);return;}
  if(current){scene.remove(current);mixer?.stopAllAction();dispose(current);}
  current=gltf.scene;normalToggle.checked=true;scene.add(current);mixer=new THREE.AnimationMixer(current);clip=gltf.animations[0];
  if(clip){action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(0);}
  const bounds=new THREE.Box3().setFromObject(current),restSize=bounds.getSize(new THREE.Vector3());
  if(clip&&action){for(const t of [.25,.5,.75,1]){action.paused=false;action.enabled=true;mixer.setTime(t*clip.duration);bounds.union(new THREE.Box3().setFromObject(current));}action.paused=false;action.enabled=true;mixer.setTime(0);}
  const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  (document.getElementById('progress') as HTMLInputElement).value='0';
  controls.target.copy(center);const distance=Math.max(size.x,size.y,size.z)*2.6;camera.position.copy(center).add(new THREE.Vector3(.55,.35,1).multiplyScalar(distance));camera.near=.001;camera.far=10;camera.updateProjectionMatrix();
  const roots=['SCREEN_ASSEMBLY','CHASSIS_ASSEMBLY','CAMERA_ASSEMBLY','BACKPLATE_ASSEMBLY'].filter(n=>current!.getObjectByName(n));
  const productRoot=['PHONE_ROOT','AIRPODS_ROOT','ACCESSORIES_ROOT','CONNECTIVITY_ROOT','ICON_ROOT'].map(n=>current!.getObjectByName(n)).find(Boolean);
  parts=productRoot?.children??[];partSelect.replaceChildren(new Option('All parts',''));
  for(const part of parts)partSelect.add(new Option(part.name.replaceAll('_',' '),part.name));
  partSelect.disabled=parts.length<2;
  status.textContent=`Posed bounds: ${(restSize.x*1000).toFixed(1)} × ${(restSize.y*1000).toFixed(1)} × ${(restSize.z*1000).toFixed(1)} mm. ${roots.length} phone assemblies. ${gltf.animations.length} animation clip(s).`;
 }catch(error){status.textContent=`Model unavailable: ${String(error)}`;}
}
document.getElementById('model')!.addEventListener('change',e=>void load((e.target as HTMLSelectElement).value));
document.getElementById('progress')!.addEventListener('input',e=>{if(clip&&action){action.paused=false;action.enabled=true;mixer?.setTime(Number((e.target as HTMLInputElement).value)*clip.duration);}});
document.getElementById('background')!.addEventListener('change',e=>{scene.background=new THREE.Color((e.target as HTMLSelectElement).value);});
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);if(current)dispose(current);scene.environment?.dispose();ktx.dispose();controls.dispose();renderer.dispose();},{once:true});
void load('hero-portable');
