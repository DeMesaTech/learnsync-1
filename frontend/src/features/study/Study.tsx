import {Navigate,useParams} from 'react-router-dom';
import type {AiStatus} from './types';

export function SimulatorNotice({status}:{status?:AiStatus}){
  return status?.simulated?<p className="warn" role="status"><strong>Development simulator.</strong> Replies are canned excerpts from your materials, not a real AI. Do not judge answer quality, language or safety from them.</p>:null;
}

/** The old per-subject Study help tab: chats now live in the Study buddy (bottom-right) and on its page. */
export function StudentStudy(){
  const {offeringId}=useParams();
  return <Navigate to={`/student/study-buddy?subject=${offeringId}`} replace/>;
}
