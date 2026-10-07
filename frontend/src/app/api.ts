export interface Account {id:string;email:string;display_name:string;role:'admin'|'faculty'|'student';status:string;student_number:string|null;preferences:{theme?:Theme}}
export type Theme='system'|'light'|'dark';
export interface SessionInfo {user:Account|null;csrf:string}
export class ApiError extends Error {constructor(public status:number,public code:string,message:string,public fields:Record<string,string>={}){super(message)}}
let csrf='';
export function setCsrf(value:string){csrf=value}
export async function api<T>(path:string, options:RequestInit={}):Promise<T>{
 const response=await fetch('/api'+path,{credentials:'same-origin',...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.method&&options.method!=='GET'?{'X-CSRF-Token':csrf}:{}),...options.headers}});
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new ApiError(response.status,body.error?.code||'request_failed',body.error?.message||'Request failed. Try again.',body.error?.field_errors||{})}
 return response.status===204?undefined as T:response.json();
}
// a request that never answers (API up, database down) must end in the "cannot reach the server" message, not an endless Loading
export async function getSession(){const data=await api<SessionInfo>('/auth/session',{signal:AbortSignal.timeout(10000)});setCsrf(data.csrf);return data}
export function post<T>(path:string,data:unknown){return api<T>(path,{method:'POST',body:JSON.stringify(data)})}
export function send<T=void>(method:'PUT'|'PATCH'|'DELETE'|'POST',path:string,data?:unknown){return api<T>(path,{method,body:data===undefined?undefined:JSON.stringify(data)})}
export function upload<T>(path:string,form:FormData){return api<T>(path,{method:'POST',body:form})}
export const errorText=(e:unknown,fallback='Something went wrong. Try again.')=>e instanceof Error?e.message:fallback;
