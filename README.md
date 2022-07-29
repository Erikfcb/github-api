# How to run:

1. Clone the project and run `npm i`
2. Get access token from Github https://github.com/settings/tokens/new
3. Set it as environment variable GITHUB_ACCESS_TOKEN
4. Run `npm start`

# Process:

1.  start function runs trough all repos checks withe status.json that the repo is still not finished and pass the owner/repo and page to checkSetOfPullRequests
2.  checkSetOfPullRequests makes a call to Github api to get 100 prs by the page received. Iterates through prs, excluding some by conditions, and makes a call to Github api to get all comments of each pr. Iterates through comments, excluding some by conditions, and passing comment to handleComment. (pushing all handleComment() async function into array which will be executed with Promise.all to make them parallel)
3.  handleComment passes gets full "before"(comment) file and full "after" file by calling getFullFileText function, which makes a call to Github api (tree) by commit hash. After having both before and after, handleComment passes them to getFinalBeforeAndAfter for parsing.
4.  getFinalBeforeAndAfter takes two full files (before, after) as strings and then creating diff hunk between the two. From the diff hunk extracting all new code(+) and non-changed code to new variable "finalAfter" and extracting all old code(-) and non-changed code to new variable "finalBefore".
5.  After having final versions of before and after the next step in handleComment is to write a new file in datasets folder.

# Notes:

1. If there's an error in the global try catch we catch it record it in errors.json and call again the start function to try again.
2. after each pr check we update status,json file with the create_at field of the pr, so next time running the program it will continue from the last checked pr and not from the beginning.
3. The list of repos is filtered by having more than 50 prs, 10 stars, 10 contributors and that the project is written in Javascript.
4. With the access token of Github, there's a limit of 5,000 calls per hour. When the program runs, on every request to Github it checks the amount of available requests (checkLimitReset), if you reached the limit it will wait until reset and continue automatically when the limit was reset.
5. Total amount of Github calls:
   1. one call for 100 prs per page.
   2. one call for pr comments
   3. one call for whole "before" file
   4. one call for whole "after" file
