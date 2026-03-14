---
layout: page
title: A OneFS ChangeList Explorer
tags: OneFS PowerScale API TOOL #IWORK4DELL
---

# A OneFS ChangeList Viewer

A blazing-fast, serverless, and fully responsive pure HTML/CSS/JS application to visually browse Dell PowerScale OneFS Changelist API results.

![OneFS ChangeList Viewer UI Preview](https://raw.githubusercontent.com/mupplelabs/OneFS_ChangeList_Viewer/refs/heads/main/Changelist_Explorer.png) 

## Overview
This tool is designed for administrators and developers working with the OneFS RESTful API. It takes JSON output from the `/10/changelist/<CHANGELIST>/entries` endpoint and provides a rich, interactive Explorer interface to navigate directory structures, uncover file moves, and filter changes by type and path.

## Features
- **Serverless Architecture**: Runs entirely in the browser. Zero dependencies, no backend, no heavy third-party libraries required. Just open `index.html` (via a local web server to prevent CORS issues if using the dynamic fetch capability).
- **Analytics Dashboard**: A full-screen, responsive CSS-grid overlay providing pure-DOM bar charts to instantly visualize API change types, physical capacity churn, and hot directories.
![OneFS ChangeList Analytics UI Preview](https://raw.githubusercontent.com/mupplelabs/OneFS_ChangeList_Viewer/refs/heads/main/ChangeList_Analytics.png) 

- **Smart Move Detection**: Identifies file and directory movements/renames accurately using LIN matching, ID matching, and loose heuristic time-window correlation.
- **Directory Explorer Pane**: A collapsible, searchable tree-view mirroring the changed files' structure.
- **Advanced Filtering & Sorting**: Filter rows by file type, specific change strings, or flexible text search. Click on any visible column header to type-aware sort the dataset ascending or descending.
- **Pure CSS Responsiveness**: The UI gracefully degrades from a 3-pane desktop layout down to an intuitive, auto-hiding CSS overlay system for tablets and smartphones. (Look ma, no JS toggles!).
- **Customizable Grid**: Select which columns you want to view, such as `Size`, `Physical Size`, `UID/GID`, `Parent LIN`, and timestamps.
- **Data Export**: Export your customized table view directly to `.csv` or `.json` for external reporting.
- **Syntax Highlighting**: Built-in JSON prettifying panel makes inspecting the raw API metadata simple and readable.
- **Theming & Linking**: Ships with VSCode-inspired Light and Dark modes. Share links to pre-configure the app via URL parameters (e.g., `?theme=light` or `?data_url=http://server/demo.json`).

## Usage
1. Clone the repository or download the source files.
2. We highly recommend serving the directory using a lightweight local web server (e.g., `python3 -m http.server 8000`) instead of opening the HTML directly from your desktop. This prevents modern browser CORS security policies from blocking the dynamic `fetch()` requests when loading demo files or external URLs.
3. Open the hosted `index.html` in your favorite modern browser (Chrome, Edge, Firefox, Safari).
4. Use the **Open File** button to select your local `.json` OneFS changelist dump.
5. Alternatively, click **Load Demo** to explore with the included `large_changelist_demo.json` dataset.
6. You can automatically configure the application on load by passing URL parameters: `http://localhost:8000/index.html?theme=light&data_url=https://your-server.com/api/latest_changelist.json`.

## Fetching Data from OneFS API
To generate the necessary JSON file for this tool, query the OneFS Platform API:
```bash
curl -u <username>:<password> -k \
  "https://<cluster-ip>:8080/platform/10/snapshot/changelists/<CHANGELIST>/entries" \
  > changelist_entries.json
```
*Note: Ensure your REST API user has the appropriate RBAC privileges to query changelists.*

## Customization
This tool was built to be easily customizable. If you need to add new columns from the API payload:
- **`app.js`**: Add new column objects to the `ALL_COLUMNS` array.
- **`styles.css`**: Tweak variables at the top of the file to match your organization's branding.

## Addendum
I want to be honest here: This is the result of me experimenting with Googles Antigravity.
It first started with me trying some explanation I have prepared for customers on our internal Chatbot as well as on M$ Copilot. Which was never intended to generate code - but it somehow did. (When I reviewed the prompts: I became clear why it did that, I implied to the bot that the audience are Systems Engieneers / Developers...) 

Anyway, it produced a prototype that I was able to get working in no time - it was not polished at all and very obviously a quick and dirty stitched together piece of web app. As implied this was never meant to be a „project“ after all. 

Now that I heard and read more about antigravity, I thought this is the perfect non-project project to trow at it. The result took me just a few hours of a Friday afternoon, that's including downloading, installing and exploring the tool as a first time user. All while I was doing other stuff in parallel as usual.

Especially as I am anything but a Web/CSS developer/designer this would have taken me at least days otherwise... it also created the demo data set in no time based on the API spec [developer.dell.com](https://developer.dell.com/apis/4088/versions/9.13.0/9.13.0.0_QUICKSTEP_OAS3.json/paths/~1platform~110~1snapshot~1changelists~1%7BChangelist%7D~1entries/get) and a little example from a OneFS Simulator - not very complicated but time consuming.

**Now what did I learn?**

Well nothing really, i still suck with CSS, my Javascript skills are still a bit rusty to say the least (have I mentioned that I am not a web developer?).
It actually raised more questions: 
- Where do we go from here? 
- Do I want to use this more going forward? 
- Where are the limits? 
- Are there limits? 
- Should there be limits?
- Do WE really need or even want this? 

At this time I cannot answer any of these questions really.

**So let me conclude with this: Its an impressive, extremly powerful tool and (a little) scary.**

## Links
[Try me...](/tools/OneFS_ChangeList_Viewer/index.html?theme=light)


[OneFS ChangeList Viewer on GitHub](https://github.com/mupplelabs/OneFS_ChangeList_Viewer)
