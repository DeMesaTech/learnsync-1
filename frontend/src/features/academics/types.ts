export interface Term{id:string;school_year_id:string;name:string;sequence:number;status:'open'|'closed';start_date:string;end_date:string;reopened_reason:string|null}
export interface SchoolYear{id:string;label:string;start_date:string;end_date:string;terms:Term[]}
export interface Subject{id:string;code:string;title:string;units:string;year_level:number|null;semester:number|null;description:string;status:'active'|'archived'}
export interface Section{id:string;term_id:string;name:string;year_level:number;member_count:number}
export interface Member{student_id:string;display_name:string;email:string;student_number:string}
export interface OfferingSummary{meeting_days?:number;id:string;term_id:string;term:string;term_status:'open'|'closed';subject:{id:string;code:string;title:string;units:string};faculty:{id:string;display_name:string};sections:{id:string;name:string;enrolled:number}[];enrolled:number}
export interface RosterRow{student_id:string;display_name:string;student_number:string;section:string|null;source:'regular'|'exception';status:'enrolled'|'withdrawn'|'excluded';exception_reason?:string}
export interface MySubject{offering_id:string;term:string;term_status:string;subject:{id:string;code:string;title:string;units:string};faculty:{display_name:string};enrollment_status:string}
export interface ImportRow{row:number;student_number:string;email:string;display_name:string;section:string;status:'new'|'existing'|'error';errors:string[]}
export interface StudentPreview{id:string;status:string;summary:{new:number;existing:number;errors:number;total:number};rows:ImportRow[]}
export interface DraftRow{index?:number;code:string;title:string;units:string|null;year_level:number|null;semester:number|null;exists?:boolean;errors?:string[]}
export interface ProspectusDraft{id:string;status:string;revision:number;warnings:string[];subjects:DraftRow[]}
export const yearLabel=(n:number|null)=>n?['','1st','2nd','3rd','4th','5th','6th'][n]+' year':'Unplaced';
