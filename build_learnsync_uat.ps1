$ErrorActionPreference = 'Stop'

$outDir = Join-Path $PSScriptRoot 'output'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$outFile = Join-Path $outDir 'LearnSync_User_Acceptance_Test.docx'

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Add()

# Word constants
$wdCollapseEnd = 0; $wdPageBreak = 7; $wdSectionBreakNextPage = 2
$wdAlignLeft = 0; $wdAlignCenter = 1; $wdAlignRight = 2
$wdLineStyleSingle = 1; $wdCellAlignVerticalCenter = 1
$wdHeaderFooterPrimary = 1; $wdFormatXMLDocument = 12
$wdColorWhite = 16777215; $navy = 5253135; $blue = 12566463; $paleBlue = 15921906; $gray = 14277081; $darkGray = 7368816

function Add-Para([string]$Text='', [int]$Size=10, [bool]$Bold=$false, [int]$Align=0, [int]$SpaceBefore=0, [int]$SpaceAfter=6, [string]$Font='Aptos') {
    $p = $doc.Paragraphs.Add()
    $p.Range.Text = $Text
    $p.Range.Font.Name = $Font
    $p.Range.Font.Size = $Size
    $p.Range.Font.Bold = [int]$Bold
    $p.Range.ParagraphFormat.Alignment = $Align
    $p.Range.ParagraphFormat.SpaceBefore = $SpaceBefore
    $p.Range.ParagraphFormat.SpaceAfter = $SpaceAfter
    $p.Range.ParagraphFormat.LineSpacingRule = 0
    return $p
}
function Add-Heading([string]$Text, [int]$Level=1) {
    $size = if($Level -eq 1){14}else{11}
    $p = Add-Para $Text $size $true $wdAlignLeft (if($Level -eq 1){14}else{8}) 6
    $p.Range.Font.Color = 0
    return $p
}
function Add-Bullets([string[]]$Items) {
    foreach($item in $Items) {
        $p = Add-Para $item 10 $false $wdAlignLeft 0 3
        $p.Range.ListFormat.ApplyBulletDefault() | Out-Null
    }
}
function Set-CellText($cell, [string]$text, [bool]$bold=$false, [int]$size=8.5, [int]$align=0) {
    $r = $cell.Range
    $r.End = $r.End - 1
    $r.Text = $text
    $r.Font.Name = 'Aptos'
    $r.Font.Size = $size
    $r.Font.Bold = [int]$bold
    $r.ParagraphFormat.Alignment = $align
    $r.ParagraphFormat.SpaceAfter = 0
    $cell.VerticalAlignment = $wdCellAlignVerticalCenter
    $cell.TopPadding = 5; $cell.BottomPadding = 5; $cell.LeftPadding = 5; $cell.RightPadding = 5
}
function Add-Table([string[]]$Headers, [object[]]$Rows, [double[]]$Widths=$null) {
    $range = $doc.Range($doc.Content.End-1, $doc.Content.End-1)
    $t = $doc.Tables.Add($range, $Rows.Count + 1, $Headers.Count)
    $t.AllowAutoFit = $false
    $t.Borders.Enable = 1
    $t.Borders.OutsideColor = $gray; $t.Borders.InsideColor = $gray
    for($c=1; $c -le $Headers.Count; $c++) {
        Set-CellText $t.Cell(1,$c) $Headers[$c-1] $true 8 $wdAlignCenter
        $t.Cell(1,$c).Shading.BackgroundPatternColor = $navy
        $t.Cell(1,$c).Range.Font.Color = $wdColorWhite
        if($Widths) { $t.Cell(1,$c).Width = $Widths[$c-1] }
    }
    for($r=0; $r -lt $Rows.Count; $r++) {
        $vals = @($Rows[$r])
        for($c=1; $c -le $Headers.Count; $c++) {
            $align = if($c -eq 1 -or $c -eq $Headers.Count){$wdAlignCenter}else{$wdAlignLeft}
            Set-CellText $t.Cell($r+2,$c) ([string]$vals[$c-1]) $false 8.25 $align
            if(($r % 2) -eq 1) { $t.Cell($r+2,$c).Shading.BackgroundPatternColor = $paleBlue }
            if($Widths) { $t.Cell($r+2,$c).Width = $Widths[$c-1] }
        }
    }
    $t.Rows(1).HeadingFormat = -1
    $doc.Paragraphs.Add() | Out-Null
    return $t
}
function Add-PageBreak { $doc.Range($doc.Content.End-1, $doc.Content.End-1).InsertBreak($wdPageBreak) }

# Page setup and header/footer
$sec = $doc.Sections.Item(1)
$sec.PageSetup.TopMargin = $word.CentimetersToPoints(2.2)
$sec.PageSetup.BottomMargin = $word.CentimetersToPoints(2.0)
$sec.PageSetup.LeftMargin = $word.CentimetersToPoints(2.15)
$sec.PageSetup.RightMargin = $word.CentimetersToPoints(2.15)
$header = $sec.Headers.Item($wdHeaderFooterPrimary).Range
$header.Text = 'LEARNING MANAGEMENT SYSTEM | USER ACCEPTANCE TEST'
$header.Font.Name='Aptos'; $header.Font.Size=8; $header.Font.Bold=1; $header.Font.Color=$darkGray
$header.ParagraphFormat.Alignment=$wdAlignRight
$footer = $sec.Footers.Item($wdHeaderFooterPrimary).Range
$footer.Text = 'LearnSync User Acceptance Test  |  Internal evaluation copy'
$footer.Font.Name='Aptos'; $footer.Font.Size=8; $footer.Font.Color=$darkGray
$footer.ParagraphFormat.Alignment=$wdAlignCenter

# Cover
Add-Para '' 10 $false $wdAlignLeft 42 12 | Out-Null
$p = Add-Para 'LEARN SYNC' 20 $true $wdAlignCenter 0 4
$p.Range.Font.Color = $navy
Add-Para 'USER ACCEPTANCE TEST' 24 $true $wdAlignCenter 0 8 | Out-Null
Add-Para 'Test Protocol, Task Records, Results Summary, and Sign Off' 12 $false $wdAlignCenter 0 26 | Out-Null
Add-Para 'Purpose' 11 $true $wdAlignLeft 0 4 | Out-Null
Add-Para 'This document provides a structured, participant based User Acceptance Test for LearnSync. It records whether representative administrators, faculty members, and students can complete essential learning management tasks in a realistic test environment, and provides an evidence based basis for acceptance decisions.' 10 $false $wdAlignLeft 0 16 | Out-Null
Add-Table @('Document control','Details') @(
    @('System','LearnSync learning management system'),
    @('Test type','User Acceptance Test'),
    @('Prepared for','LearnSync project team and academic stakeholders'),
    @('Prepared date','14 November 2026'),
    @('Test status','Ready for execution - results not yet recorded'),
    @('Confidentiality','Use participant codes only. Do not enter passwords or real student records.')
) @(130,350) | Out-Null
Add-Para 'Acceptance statement' 11 $true $wdAlignLeft 10 4 | Out-Null
Add-Para 'A final acceptance decision must be based on completed participant sessions, recorded evidence, and resolution or formal acceptance of all blocking issues. This template does not claim that user acceptance has passed.' 10 $false $wdAlignLeft 0 0 | Out-Null

Add-PageBreak
Add-Heading '1  Test Overview' 1 | Out-Null
Add-Para 'LearnSync supports academic administration, faculty teaching workflows, and student learning activities. The UAT evaluates whether intended users can complete essential role specific tasks with acceptable clarity, reliability, and usability. The supplied Results and Discussion lesson is used as learning material in the faculty publishing and student learning tasks.' 10 $false $wdAlignLeft 0 8 | Out-Null
Add-Heading '1.1 Objectives' 2 | Out-Null
Add-Bullets @(
    'Validate that representative users can complete core tasks without unnecessary assistance.',
    'Confirm that published learning material, assessments, feedback, grades, and reporting flows are understandable to their intended roles.',
    'Identify usability concerns, defects, permission issues, and unmet expectations before acceptance.',
    'Capture structured evidence that can be summarized in the Results and Discussion section of the project report.'
)
Add-Heading '1.2 Scope' 2 | Out-Null
Add-Table @('Role','Included acceptance areas') @(
    @('Administrator','Academic setup, prospectus/subject setup, section and roster management, invitations, and account status.'),
    @('Faculty','Workspace orientation, grading and feedback, results release, announcements, grade export, and lesson publishing.'),
    @('Student','Onboarding, next steps and due work, lesson completion, Study Help, quiz and grade results, and issue reporting.')
) @(115,365) | Out-Null
Add-Heading '1.3 Out of Scope' 2 | Out-Null
Add-Bullets @('Load, stress, and security penetration testing.', 'Production data migration or live account changes.', 'Evaluation of AI answer quality beyond the participant experience; Study Help should be exercised only when it is configured for the test environment.')
Add-Heading '1.4 Test Environment and Entry Criteria' 2 | Out-Null
Add-Table @('Item','Required condition') @(
    @('Environment','A disposable LearnSync environment with test-only data.'),
    @('Accounts','Dedicated administrator, faculty, and student accounts; do not record passwords.'),
    @('Content','A class/section, a Results and Discussion lesson resource, sample activity submissions, a quiz, and a grade record are prepared.'),
    @('Facilitator','A facilitator records time, help requested, defects, and observations without coaching task steps.'),
    @('Participants','At least two to three participants collectively representing administrator, faculty, and student roles.')
) @(115,365) | Out-Null

Add-PageBreak
Add-Heading '2  Test Method and Evidence Rules' 1 | Out-Null
Add-Heading '2.1 Session Procedure' 2 | Out-Null
Add-Bullets @(
    'Test one participant at a time. Give the task prompt exactly as written, without naming a page, menu, or button.',
    'Start timing when the task is read. Stop after three minutes or when the participant asks to stop.',
    'Record completion status, elapsed time, help required, wrong turns, participant comments, and any observed defect before continuing.',
    'Do not include names, passwords, student numbers, grades, screenshots containing personal data, or other sensitive information in this document.',
    'Participants may stop at any time. Testing evaluates the system, not the participant.'
)
Add-Heading '2.2 Completion Ratings' 2 | Out-Null
Add-Table @('Rating','Definition','Treatment') @(
    @('Completed without help','Participant finished the task independently within three minutes.','Counts as a successful task completion.'),
    @('Completed with help','Participant finished after a facilitator clarification or navigation help.','Counts as completed, but contributes to a usability observation.'),
    @('Not completed','Participant did not finish, abandoned the task, or encountered a blocking issue.','Requires an observation or defect record.'),
    @('Not applicable','Task cannot be run because a required test condition is unavailable.','Exclude from completion rate; state why.')
) @(120,180,180) | Out-Null
Add-Heading '2.3 Post Test Rating Scale' 2 | Out-Null
Add-Para 'For each statement, circle one response: 5 = strongly agree, 4 = agree, 3 = neither agree nor disagree, 2 = disagree, 1 = strongly disagree. Record the mean only after at least two participants have answered the item.' 10 $false $wdAlignLeft 0 6 | Out-Null
Add-Table @('Mean range','Interpretation') @(
    @('4.21 - 5.00','Strongly acceptable'), @('3.41 - 4.20','Acceptable'), @('2.61 - 3.40','Neutral / needs review'), @('1.81 - 2.60','Not acceptable'), @('1.00 - 1.80','Strongly not acceptable')
) @(150,330) | Out-Null
Add-Heading '2.4 Acceptance Rules' 2 | Out-Null
Add-Bullets @(
    'No unresolved blocker may remain. A blocker includes data loss, a permission boundary failure, exposed private information, incorrect assessment answer exposure, or a failure that prevents a core role from completing essential work.',
    'Each role must complete its essential tasks, or any exception must be documented and accepted by the designated approver.',
    'The overall completion rate, usability ratings, open issues, and participant feedback must be summarized before sign off.',
    'A conditional acceptance may be used only when remaining issues are non-blocking, have owners and target dates, and are explicitly accepted by the approver.'
)

Add-PageBreak
Add-Heading '3  Participant and Session Record' 1 | Out-Null
Add-Para 'Complete one participant record per session. Use a non-identifying code rather than a name.' 10 $false $wdAlignLeft 0 8 | Out-Null
Add-Table @('Field','Record') @(
    @('Participant code','____________________________________________'),
    @('Role','Administrator  /  Faculty  /  Student'),
    @('Session date and time','____________________________________________'),
    @('Facilitator','____________________________________________'),
    @('Device and screen size','____________________________________________'),
    @('Browser','____________________________________________'),
    @('Prior LMS experience','None  /  Some  /  Frequent'),
    @('Test environment / build','____________________________________________')
) @(150,330) | Out-Null
Add-Heading '3.1 Facilitator Opening Script' 2 | Out-Null
Add-Para 'We are testing the system, not you. Please work through each task as you normally would. I will not guide you unless you ask to stop. You may stop at any time. We will record your task outcome and feedback, but we will not record passwords or personal information.' 10 $false $wdAlignLeft 0 12 | Out-Null
Add-Heading '3.2 Task Record Key' 2 | Out-Null
Add-Para 'For each task, record result as CW = completed without help, CH = completed with help, NC = not completed, or NA = not applicable. Use the observation reference to point to the issue log when needed.' 10 $false $wdAlignLeft 0 6 | Out-Null

# Task tables
Add-PageBreak
Add-Heading '4  Administrator Acceptance Tasks' 1 | Out-Null
Add-Para 'Facilitator: provide the participant with the required prospectus and student list. One student-list row should name a section that does not exist. Do not identify the target pages or controls in the prompts.' 9.5 $false $wdAlignLeft 0 8 | Out-Null
$adminRows = @(
    @('A1','Set up the coming semester for the school.','A new academic term is created and ready for setup.','___','___','___'),
    @('A2','Add the subjects from the curriculum prospectus you were given.','Subjects can be reviewed and added without unexplained errors.','___','___','___'),
    @('A3','Create a section called 1A and assign a teacher to its subject.','The section and teacher assignment are saved and visible.','___','___','___'),
    @('A4','Add the students from the supplied list to section 1A. One row names a section that does not exist.','Valid rows are handled correctly; the invalid row produces a clear, actionable message.','___','___','___'),
    @('A5','Find an invited person who has not accepted yet and resend their invitation.','The participant identifies the pending invite and completes the resend action.','___','___','___'),
    @('A6','A student says their account is locked. Find the account, deactivate it, then make it active again.','The account status changes are clear, recorded, and leave the account active.','___','___','___')
)
Add-Table @('ID','Task prompt','Expected outcome','Result','Time s','Obs ref') $adminRows @(40,185,160,45,45,50) | Out-Null
Add-Heading 'Administrator Session Notes' 2 | Out-Null
Add-Para 'Repeated confusion, assistance provided, or observed issues: ____________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 6 | Out-Null
Add-Para '______________________________________________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 0 | Out-Null

Add-PageBreak
Add-Heading '5  Faculty Acceptance Tasks' 1 | Out-Null
Add-Para 'Facilitator: prepare three activity submissions, a grade-ready class, and the supplied Results and Discussion PDF in the test environment. The participant may use the material as a lesson resource.' 9.5 $false $wdAlignLeft 0 8 | Out-Null
$facultyRows = @(
    @('F1','Accept your invitation and choose a password.','The account is activated and the participant can enter the faculty workspace.','___','___','___'),
    @('F2','Find out what needs your attention today.','The participant locates the relevant teaching task or indicator.','___','___','___'),
    @('F3','Grade the three activity submissions and give one student feedback.','Scores and feedback are saved; feedback is associated with the intended student.','___','___','___'),
    @('F4','Make the results visible to students.','The release action and its effect are understandable and complete.','___','___','___'),
    @('F5','Write an announcement for section 1A only.','The announcement is addressed to the correct section and can be published.','___','___','___'),
    @('F6','Publish the Midterm grade for your class and download it as a PDF.','Grade publication is explicit and the PDF export downloads successfully.','___','___','___'),
    @('F7','Publish the provided Results and Discussion PDF as a lesson for the appropriate class.','The lesson is published and available to the intended students.','___','___','___')
)
Add-Table @('ID','Task prompt','Expected outcome','Result','Time s','Obs ref') $facultyRows @(40,185,160,45,45,50) | Out-Null
Add-Heading 'Faculty Session Notes' 2 | Out-Null
Add-Para 'Repeated confusion, assistance provided, or observed issues: ____________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 6 | Out-Null
Add-Para '______________________________________________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 0 | Out-Null

Add-PageBreak
Add-Heading '6  Student Acceptance Tasks' 1 | Out-Null
Add-Para 'Facilitator: ensure the participant has access to the published Results and Discussion lesson, a quiz, a released result/grade, and the problem-report function. For task S4, do not tell the participant the distinction between reporting results and interpreting them; this may be checked after the task.' 9.5 $false $wdAlignLeft 0 8 | Out-Null
$studentRows = @(
    @('S1','Accept your invitation and choose a password.','The account is activated and the participant can enter the student workspace.','___','___','___'),
    @('S2','Find the next thing you should do.','The participant locates the next applicable learning task.','___','___','___'),
    @('S3','Find everything due this week across your subjects.','Due work can be found and interpreted without navigation confusion.','___','___','___'),
    @('S4','Open the Results and Discussion lesson, mark it complete, and ask Study Help to explain one idea from it in simpler words.','The lesson opens, completion is recorded, and Study Help returns an understandable response when configured.','___','___','___'),
    @('S5','Take the quiz, then find your result and Midterm grade.','Quiz completion, result access, and grade visibility are understandable.','___','___','___'),
    @('S6','Report a problem with the page you are on.','The participant can create a clear problem report through the available workflow.','___','___','___')
)
Add-Table @('ID','Task prompt','Expected outcome','Result','Time s','Obs ref') $studentRows @(40,185,160,45,45,50) | Out-Null
Add-Heading 'Student Session Notes' 2 | Out-Null
Add-Para 'Repeated confusion, assistance provided, or observed issues: ____________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 6 | Out-Null
Add-Para '______________________________________________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 0 | Out-Null

Add-PageBreak
Add-Heading '7  Post Test Questionnaire' 1 | Out-Null
Add-Para 'Ask each participant after completing their role specific tasks. Circle one response for each statement: 5 strongly agree, 4 agree, 3 neither agree nor disagree, 2 disagree, 1 strongly disagree.' 10 $false $wdAlignLeft 0 8 | Out-Null
$qRows = @(
    @('Q1','I could understand what I needed to do next in LearnSync.','5  4  3  2  1','___'),
    @('Q2','The labels, menus, and buttons were easy to understand.','5  4  3  2  1','___'),
    @('Q3','The system gave clear feedback after I completed an action.','5  4  3  2  1','___'),
    @('Q4','I could find important information and tasks without excessive searching.','5  4  3  2  1','___'),
    @('Q5','The system responded quickly enough for the tasks I performed.','5  4  3  2  1','___'),
    @('Q6','I would feel comfortable using LearnSync for my regular role.','5  4  3  2  1','___'),
    @('Q7','The appearance and layout were clear and readable.','5  4  3  2  1','___')
)
Add-Table @('ID','Statement','Rating','Score') $qRows @(40,300,90,50) | Out-Null
Add-Heading 'Open Feedback' 2 | Out-Null
Add-Para '1. What was the most confusing moment? ______________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 8 | Out-Null
Add-Para '2. Was there anything you expected to find but could not? ______________________________________________________________________' 9.5 $false $wdAlignLeft 0 8 | Out-Null
Add-Para '3. What is one change that would make LearnSync easier for you? ________________________________________________________________' 9.5 $false $wdAlignLeft 0 8 | Out-Null
Add-Para '4. Facilitator check for S4 (optional): Can the participant explain the difference between reporting results and discussing their meaning?  Yes / Partly / No' 9.5 $false $wdAlignLeft 0 0 | Out-Null

Add-PageBreak
Add-Heading '8  Observation and Defect Log' 1 | Out-Null
Add-Para 'Use one row for each observation. Separate participant feedback from verified defects. Escalate blockers immediately.' 10 $false $wdAlignLeft 0 8 | Out-Null
$issueRows = @()
1..8 | ForEach-Object { $issueRows += ,@("O$_",'____________________________','Admin / Faculty / Student','Usability / Defect / Question','Low / Medium / High / Blocker','Open','________') }
Add-Table @('Ref','Summary','Role','Type','Severity','Status','Owner') $issueRows @(35,145,75,80,75,50,55) | Out-Null
Add-Heading 'Blocking Issue Checklist' 2 | Out-Null
Add-Bullets @('Data loss or data corruption observed', 'Permission boundary failure or access to private information observed', 'Assessment answers or restricted results exposed to an unauthorized user', 'Core role cannot complete an essential task', 'Other critical issue: _______________________________________________')
Add-Para 'If any item is checked, do not mark UAT accepted until the issue is resolved or formally addressed in the acceptance decision.' 9.5 $true $wdAlignLeft 4 0 | Out-Null

Add-PageBreak
Add-Heading '9  Results Summary and Acceptance Decision' 1 | Out-Null
Add-Para 'Complete this section only after all planned sessions have been completed. Report observed results; do not infer acceptance from scripted checks alone.' 10 $false $wdAlignLeft 0 8 | Out-Null
Add-Heading '9.1 Task Completion Summary' 2 | Out-Null
Add-Table @('Role','Tasks planned','CW','CH','NC','NA','Completion rate') @(
    @('Administrator','6','___','___','___','___','___ %'),
    @('Faculty','7','___','___','___','___','___ %'),
    @('Student','6','___','___','___','___','___ %'),
    @('Overall','19','___','___','___','___','___ %')
) @(105,75,45,45,45,45,90) | Out-Null
Add-Para 'Completion rate = (Completed without help + Completed with help) / (Tasks planned - Not applicable) x 100.' 8.5 $false $wdAlignLeft 0 10 | Out-Null
Add-Heading '9.2 Questionnaire Summary' 2 | Out-Null
Add-Table @('Item','Mean score','Interpretation','Key evidence or comment') @(
    @('Q1','','',''), @('Q2','','',''), @('Q3','','',''), @('Q4','','',''), @('Q5','','',''), @('Q6','','',''), @('Q7','','',''), @('Overall','','','')
) @(45,85,140,180) | Out-Null
Add-Heading '9.3 Findings for Results and Discussion' 2 | Out-Null
Add-Para 'Summarize the outcomes by reporting the completion rates, questionnaire means, repeated usability concerns, and defect status. Interpret what the findings mean for LearnSync readiness, using participant evidence and verified test records. Avoid presenting unfinished sessions or scripted technical checks as completed user acceptance.' 10 $false $wdAlignLeft 0 8 | Out-Null
Add-Para 'Summary: ____________________________________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 6 | Out-Null
Add-Para '______________________________________________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 6 | Out-Null
Add-Para '______________________________________________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 12 | Out-Null
Add-Heading '9.4 Decision' 2 | Out-Null
Add-Para 'Select one:  [  ] Accepted    [  ] Conditionally accepted    [  ] Not accepted' 11 $true $wdAlignLeft 0 8 | Out-Null
Add-Para 'Basis for decision, including any accepted exceptions and target dates: _________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 6 | Out-Null
Add-Para '______________________________________________________________________________________________________________________________' 9.5 $false $wdAlignLeft 0 12 | Out-Null
Add-Table @('Approval role','Name / signature','Date') @(
    @('UAT facilitator','____________________________________________','________________'),
    @('Project representative','____________________________________________','________________'),
    @('Academic / client approver','____________________________________________','________________')
) @(125,250,105) | Out-Null

$doc.BuiltInDocumentProperties.Item('Title').Value = 'LearnSync User Acceptance Test'
$doc.BuiltInDocumentProperties.Item('Subject').Value = 'User Acceptance Test protocol, records, and sign off'
$doc.BuiltInDocumentProperties.Item('Author').Value = 'LearnSync Project Team'
$doc.SaveAs([ref]$outFile, [ref]$wdFormatXMLDocument)
$doc.Close()
$word.Quit()
Write-Output $outFile
