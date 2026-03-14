some changes in Logic :
1) when there is no content to show up, which means you are a new user (right after the setup), for initial user_profile:Can we make it something like the user is a person in the college, seeking to organise their stuff , ex:'A person in a college who wants to organize their academic and personal responsibilities efficiently'.
then load his/her recent mails(atleast fetch 50 mails to understand the person (cause this is a personalised AI platform) and determine user_profile). organise the content of the mails which are recent
2) and beside reload button , display the recent triggered or updated time and store it be X (for reference).
3) In continuation, we need to load the mails with the timing in between the time'X' & current time.
4) simulatenously ,AI background process is to modify or personalise the user_profile from the fetched content(mails), likewise it should use the user_profile to learn what content it should display the user.
5) The categories are dynamic.
6) the AI should always be aware of the tasks or content which is being displayed, so it does not duplicate it (we need to store)
7) if I star any task or content , don't make it fade away until unless I unstar it. (we should store this too) an issue I found is that when I refresh I cann't see that stared one.
8) through mails llm can find deadlines for some content and don't for someother, so to reduce complexity & hallucinations by llm, just fetch 'date' when that event gonna happen on ,and store to likewise update utill it finishes.
9) To reduce the traffic of the tasks or content we make them fade away after 24hrs, this isn't applicable for tasks with dates present on. 
10) We should never store the direct form of user's mails in the system.
11) context/tasks of the user should be static on the page.
 /////////
 work on ,
1) multiple email loop (need to find for the recent mail from there)
2) user's confused whether the application is working or not during the wait time.(we need to fix that by showing them wait-time and cancel receiving the triggers during this.)
3) sometimes we press it lot of times, so it those many times and get lot of load (or) even it may crash.
4) refresh automatically without pressing when we open it.

how to make it powerful so, multiple users can interact at a time (for free).

[remember it's reading only the recent unread mails] feature or flaw ??
////////

problem : github actions is taking too much time to run the auto_sync.py file for new users. we need to fix it.