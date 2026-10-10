import {useEffect,useState,type FormEvent} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {api,post,type Account} from '../../app/api';
import {useAuth,useTheme,queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {useConfirm} from '../../components/confirm';

function AccountActionIcon({name}:{name:'mail'|'activate'|'deactivate'|'transfer'}){
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {name==='mail' ? (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2"/>
          <path d="m3 7 9 6 9-6"/>
        </>
      ) : name==='activate' ? (
        <>
          <circle cx="12" cy="12" r="9"/>
          <path d="m8 12 2.5 2.5L16 9"/>
        </>
      ) : name==='deactivate' ? (
        <>
          <circle cx="12" cy="12" r="9"/>
          <path d="M8 12h8"/>
        </>
      ) : (
        <path d="M7 7h13l-3-3m3 3-3 3M17 17H4l3 3m-3-3 3-3"/>
      )}
    </svg>
  );
}

export function AccountSettings(){
  const {session}=useAuth();
  const {theme,setTheme}=useTheme();
  const [message,setMessage]=useState('');

  async function save(){
    try{
      await api('/me/preferences',{method:'PATCH',body:JSON.stringify({theme})});
      await queryClient.invalidateQueries({queryKey:['session']});
      setMessage('Preference saved.');
    }catch(e){
      setMessage(e instanceof Error?e.message:'Save failed.');
    }
  }

  return (
    <>
      <h1>Your account</h1>
      <section className="panel">
        <h2>{session?.user?.display_name}</h2>
        <p>{session?.user?.email}</p>
        <label>
          Appearance
          <select value={theme} onChange={e=>setTheme(e.target.value as typeof theme)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <button onClick={save}>Save preference</button>
        <p role="status">{message}</p>
        <Link className="touch" to="/forgot-password">Change password using an email link</Link>
      </section>
    </>
  );
}

export function Audit(){
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Audit history</h1>
          <p className="muted">Review recent institutional actions and changes to user access, terms, and academic records.</p>
        </div>
      </div>
      <section className="panel">
        <p className="muted">No audit events are available yet for this workspace.</p>
      </section>
    </>
  );
}

export function Accounts(){
  const {session}=useAuth();
  const confirm=useConfirm();
  const [search,setSearch]=useState('');
  const [role,setRole]=useState('');
  const [status,setStatus]=useState(()=>{
    const v=new URLSearchParams(window.location.search).get('status') ?? '';
    return ['invited','active','inactive'].includes(v)?v:'';
  });
  const [page,setPage]=useState(1);
  const [dialog,setDialog]=useState(false);
  const [handover,setHandover]=useState<Account|null>(null);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [message,setMessage]=useState('');

  const filters='search='+encodeURIComponent(search)+(role?'&role='+role:'')+(status?'&status='+status:'');
  const query=useQuery({
    queryKey:['accounts',session?.user?.id,search,role,status,page],
    queryFn:()=>api<Account[]>('/accounts?'+filters+'&page='+page),
  });
  const total=useQuery({
    queryKey:['accounts','count',session?.user?.id,search,role,status],
    queryFn:()=>api<{total:number}>('/accounts/count?'+filters),
  });
  const pages=Math.max(1,Math.ceil((total.data?.total ?? 0)/25));

  useEffect(()=>{if(total.data&&page>pages)setPage(pages);},[total.data,pages,page]);

  const mutation=useMutation({
    mutationFn:({path,body,method='POST'}:{path:string;body:unknown;method?:string})=>api(path,{method,body:JSON.stringify(body)}),
    onSuccess:()=>{
      setMessage('Changes saved.');
      setSelectedIds([]);
      queryClient.invalidateQueries({queryKey:['accounts']});
    },
    onError:e=>setMessage(e.message),
  });

  const bulkMutation=useMutation({
    mutationFn:(account_ids:string[])=>post<{sent:number;failed:number;results:{id:string;email:string;status:'sent'|'failed';message:string}[]}>('/accounts/send-links',{account_ids}),
    onSuccess:result=>{
      setSelectedIds([]);
      setMessage(result.failed?`Sent ${result.sent} link${result.sent===1?'':'s'}; ${result.failed} failed: ${result.results.filter(r=>r.status==='failed').map(r=>`${r.email} (${r.message})`).join('; ')}`:`Sent ${result.sent} account link${result.sent===1?'':'s'}.`);
      queryClient.invalidateQueries({queryKey:['accounts']});
    },
    onError:e=>setMessage(e.message),
  });

  const eligibleIds=query.data?.filter(a=>a.status!=='inactive').map(a=>a.id) ?? [];
  const allSelected=eligibleIds.length>0 && eligibleIds.every(id=>selectedIds.includes(id));

  function changeFilters(update:()=>void){
    setSelectedIds([]);
    update();
  }

  async function sendSelected(){
    if(!await confirm({
      title:`Send links to ${selectedIds.length} accounts?`,
      message:'Invited accounts receive an invitation link. Active accounts receive a password-reset link.',
      yes:'Send links',
    })) return;
    setMessage('');
    bulkMutation.mutate(selectedIds);
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const data=new FormData(e.currentTarget);
    const role=data.get('role');
    try{
      await post('/accounts',{email:data.get('email'),display_name:data.get('display_name'),role,student_number:role==='student'?data.get('student_number'):null});
      setDialog(false);
      setMessage('Invitation sent.');
      queryClient.invalidateQueries({queryKey:['accounts']});
    }catch(e){
      setMessage(e instanceof Error?e.message:'Invitation failed.');
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>User accounts</h1>
          <p className="muted">Invite users and manage access. Accounts are deactivated rather than deleted so audit history is preserved.</p>
        </div>
        <button className="primary" onClick={()=>{setMessage('');setDialog(true);}}>Invite user</button>
      </div>

      <div className="filters">
        <label>
          Search accounts
          <input value={search} onChange={e=>changeFilters(()=>{setSearch(e.target.value);setPage(1);})} placeholder="Name or email"/>
        </label>
        <label>
          Role
          <select value={role} onChange={e=>changeFilters(()=>{setRole(e.target.value);setPage(1);})}>
            <option value="">All roles</option>
            <option value="student">Students</option>
            <option value="faculty">Faculty</option>
            <option value="admin">Admins</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={e=>changeFilters(()=>{setStatus(e.target.value);setPage(1);})}>
            <option value="">Any status</option>
            <option value="invited">Invited, not yet accepted</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>

      {message && <p role="status">{message}</p>}

      {query.isPending ? (
        <p>Loading accounts?</p>
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : query.data.length===0 ? (
        <p className="panel muted">No accounts match these filters.</p>
      ) : (
        <>
          <div className="actions">
            <span role="status">{selectedIds.length} selected</span>
            <button className="primary" disabled={!selectedIds.length || bulkMutation.isPending} onClick={sendSelected}>
              {bulkMutation.isPending ? 'Sending?' : 'Send links to selected accounts'}
            </button>
            <button disabled={!selectedIds.length || bulkMutation.isPending} onClick={()=>setSelectedIds([])}>
              Clear selection
            </button>
          </div>

          <div className="table-wrap accounts-table-wrap">
            <table className="accounts-table">
              <caption className="sr-only">User accounts and available account actions</caption>
              <thead>
                <tr>
                  <th scope="col" className="checkbox-cell">
                    <input type="checkbox" aria-label="Select all eligible accounts on this page" checked={allSelected} disabled={!eligibleIds.length} onChange={e=>setSelectedIds(e.target.checked?eligibleIds:[])} />
                  </th>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map(a => {
                  const canToggle = a.status !== 'invited';
                  const sendTitle = a.status === 'invited' ? 'Resend invitation' : 'Send reset link';
                  const statusTitle = a.status === 'active' ? 'Deactivate account' : 'Activate account';

                  return (
                    <tr key={a.id}>
                      <td className="checkbox-cell">
                        <input
                          type="checkbox"
                          aria-label={`Select ${a.display_name} for bulk email`}
                          checked={selectedIds.includes(a.id)}
                          disabled={a.status==='inactive' || bulkMutation.isPending}
                          onChange={e=>setSelectedIds(current => e.target.checked ? [...current,a.id] : current.filter(id => id !== a.id))}
                        />
                      </td>
                      <th scope="row">
                        <strong>{a.display_name}</strong><br/>
                        <span>{a.email}</span>
                      </th>
                      <td>{a.role}</td>
                      <td><span className="badge">{a.status}</span></td>
                      <td>
                        <div className="actions account-actions">
                          <button type="button" className="icon-button" title={sendTitle} aria-label={sendTitle} disabled={mutation.isPending || a.status==='inactive'} onClick={()=>mutation.mutate({path:'/accounts/'+a.id+'/send-link',body:{}})}>
                            <AccountActionIcon name="mail"/>
                          </button>
                          {canToggle && (
                            <button type="button" className="icon-button" title={statusTitle} aria-label={statusTitle} disabled={mutation.isPending} onClick={()=>mutation.mutate({path:'/accounts/'+a.id+'/status',method:'PATCH',body:{status:a.status==='active'?'inactive':'active'}})}>
                              <AccountActionIcon name={a.status==='active'?'deactivate':'activate'}/>
                            </button>
                          )}
                          {a.role==='admin' && a.status==='active' && (
                            <button type="button" className="icon-button" title="Transfer admin ownership" aria-label="Transfer admin ownership" onClick={()=>setHandover(a)}>
                              <AccountActionIcon name="transfer"/>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="actions">
        <button disabled={page===1} onClick={()=>changeFilters(()=>setPage(page-1))}>Previous</button>
        <span role="status">Page {Math.min(page,pages)} of {pages}{total.data ? ` ? ${total.data.total} ${total.data.total===1?'account':'accounts'}` : ''}</span>
        <button disabled={page>=pages} onClick={()=>changeFilters(()=>setPage(page+1))}>Next</button>
      </div>

      {dialog && (
        <Dialog title="Invite user" onClose={()=>setDialog(false)}>
          <form onSubmit={submit}>
            <label>
              Full name
              <input name="display_name" required maxLength={150} />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="role">
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label>
              Student number (students only)
              <input name="student_number" maxLength={50} />
            </label>
            <p className="muted">The user receives a link to verify their email and choose a password.</p>
            {message && <p role="alert">{message}</p>}
            <div className="actions">
              <button type="button" onClick={()=>setDialog(false)}>Cancel</button>
              <button className="primary">Send invitation</button>
            </div>
          </form>
        </Dialog>
      )}

      {handover && (
        <Dialog title="Transfer institutional admin ownership" onClose={()=>setHandover(null)}>
          <p>The link goes to {handover.email}. Acceptance revokes existing sessions and replaces the password.</p>
          <form onSubmit={async e=>{
            e.preventDefault();
            const data=new FormData(e.currentTarget);
            try{
              await post('/accounts/'+handover.id+'/handover',{incoming_owner:data.get('incoming_owner'),reason:data.get('reason')});
              setHandover(null);
              setMessage('Handover link sent.');
            }catch(e){
              setMessage(e instanceof Error?e.message:'Handover failed.');
            }
          }}>
            <label>
              Incoming owner
              <input name="incoming_owner" required />
            </label>
            <label>
              Reason
              <textarea name="reason" required />
            </label>
            {message && <p role="alert">{message}</p>}
            <button className="primary">Send handover link</button>
          </form>
        </Dialog>
      )}
    </>
  );
}
