import {Outlet,useOutletContext,useParams} from 'react-router-dom';
import {SubTabs} from '../../components/SubTabs';

/** The pages that share one main tab keep their own routes and get a quiet second row of links. */
export function PeopleLayout(){
  const context=useOutletContext();const {offeringId}=useParams();const base=`/faculty/offerings/${offeringId}`;
  return <><SubTabs label="People" items={[{to:base,label:'Students',end:true},{to:`${base}/attendance`,label:'Attendance'},{to:`${base}/progress`,label:'Progress'}]}/><Outlet context={context}/></>;
}

export function GradesLayout(){
  const context=useOutletContext();const {offeringId}=useParams();const base=`/faculty/offerings/${offeringId}`;
  return <><SubTabs label="Grades" items={[{to:`${base}/gradebook`,label:'Gradebook'},{to:`${base}/class-standing`,label:'Class standing'}]}/><Outlet context={context}/></>;
}

export function StudentGradesLayout(){
  const context=useOutletContext();const {offeringId}=useParams();const base=`/student/offerings/${offeringId}`;
  return <><SubTabs label="Grades" items={[{to:`${base}/results`,label:'Grades & results'},{to:`${base}/progress`,label:'My progress'}]}/><Outlet context={context}/></>;
}
