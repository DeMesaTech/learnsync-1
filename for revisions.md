# ADMIN MAJOR CHANGES
- delete `user accounts` tab and it's linked page.
- delete all tabs in the sidebar
- keep `Students` and `Teacher` tab in the sidebar
    - for student link
        - make the `student management` tab to have separate page
    - for teacher tab
        - use the `offerings` tab and rename it with proper labeling
- rename prospectus and demote its sidebar position down to `oversight ` nav group
**student management page**
- demote `import students` button after `section dropdown`,same with add section
- promote `section` dropdown to the `year level` tab, make the year level tab hover and show the `section` dropdown
**student management logic**
- When importing students, assign them to the currently open year level and the currently selected section. Use these selections as the import destination.

- make a `settings` page and a nav-link to accomodate `school year`.

# SETTINGS CONTENTS AND LOGICS
**Logic**
- if a new school year were created
    - then the previous school year will be transfer into archieve
    - two semester were created but the `first semester` were the only one active, and have anything that can change active semester
- - add other relevant settings but make it less of a bloated options.




# List of sidebar links
- Dashboard
- Student Management
    - the page is in the teakworkspace.tsx:166-235: transfer this into a whole separate page
-  Offerings(rename this into user friendly label)
    - the page is in the teamworkspace.tsx:237-261: transfer this into a whole separate page
- settings.