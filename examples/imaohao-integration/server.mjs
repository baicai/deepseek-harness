/** iMaoHao customer contract server (MOCK ONLY). Node 22+, zero npm packages. */
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'

const key = process.env.IMAOHAO_INTEGRATION_SERVICE_TOKEN ?? 'dev-only-change-me-123456'
const users = new Map()
const models = [{id:'default',name:'默认'}, {id:'iMaoHao-V6.1-Astra',name:'iMaoHao-V6.1-Astra'}]
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))}
async function read(req){let size=0,parts=[];for await(const b of req){size+=b.length;if(size>1024*1024)throw Error('too large');parts.push(b)}return JSON.parse(Buffer.concat(parts).toString('utf8'))}
const server=createServer((req,res)=>{void(async()=>{
 const path=new URL(req.url??'/', 'http://127.0.0.1').pathname
 const bearer=(req.headers.authorization??'').replace(/^Bearer /i,'')
 const service=bearer===key, user=users.get(bearer)
 if(req.headers.origin){send(res,403,{error:{message:'Origin not allowed'}});return}
 if(path==='/health'&&req.method==='GET'){send(res,200,{status:'ok',mode:'mock'});return}
 if(path==='/auth/login'&&req.method==='POST'){
  if(!service){send(res,401,{error:{message:'Service key required'}});return}
  const body=await read(req)
  // CUSTOMER TODO: use corporate IAM / OIDC, MFA, tenant validation and session issuance.
  if(body.username!=='demo@imaohao.com'||body.password!=='demo123456'){send(res,401,{error:{message:'Invalid login'}});return}
  const token=randomBytes(32).toString('hex'), profile={id:'demo-001',name:'贸号演示用户',email:'demo@imaohao.com',tenant_id:'demo',roles:['user']}
  users.set(token,profile)
  send(res,200,{access_token:token,token_type:'Bearer',expires_in:3600,user:profile});return
 }
 if(path==='/auth/me'&&req.method==='GET'){send(res,user?200:401,user??{error:{message:'Unauthenticated'}});return}
 if(path==='/auth/logout'&&req.method==='POST'){users.delete(bearer);send(res,200,{success:true});return}
 if(path==='/v1/models'&&req.method==='GET'){
  if(!service&&!user){send(res,401,{error:{message:'Unauthorized'}});return}
  // CUSTOMER TODO: return the models available to this user/tenant from your model gateway.
  send(res,200,{object:'list',data:models.map(m=>({...m,object:'model',owned_by:'imaohao',capabilities:{text:true,streaming:true,tools:false}}))});return
 }
 if(path==='/v1/chat/completions'&&req.method==='POST'){
  if(!service&&!user){send(res,401,{error:{message:'Unauthorized'}});return}
  const body=await read(req)
  if(!models.some(m=>m.id===body.model)){send(res,404,{error:{message:'Unknown model'}});return}
  // CUSTOMER TODO: forward model, messages, tools, stream and usage to your inference backend.
  const id='chatcmpl-'+randomUUID(), created=Math.floor(Date.now()/1000)
  const content='【贸号 Mock】'+body.model+'：模拟回复，未调用真实模型。'
  const fields={id,created,model:body.model}
  if(body.stream!==true){
   send(res,200,{...fields,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:8,total_tokens:9}});return
  }
  res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache'})
  const frame=(delta,finish_reason)=>res.write('data: '+JSON.stringify({...fields,object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})+'\n\n')
  frame({role:'assistant'},null);frame({content},null);frame({},'stop');res.end('data: [DONE]\n\n');return
 }
 send(res,404,{error:{message:'Not found'}})
})().catch(()=>{if(!res.headersSent)send(res,400,{error:{message:'Malformed request'}});else res.end()})})
const port=Number(process.env.IMAOHAO_DEMO_PORT??39401)
server.listen(port,'127.0.0.1',()=>console.log('IMAOHAO_INTEGRATION_READY=http://127.0.0.1:'+server.address().port))
