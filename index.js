import nodeFetch from "node-fetch";
import { createTwoFilesPatch, parsePatch } from "diff";
import fs from "fs";
import { repositories } from "./repositories.js";

// const diffs = await nodeFetch(
//   "https://github.com/vercel/next.js/pull/38844.diff"
// );
// console.log("diffs: ", await streamToString(diffs.body));

const statusFilePath = "status.json";

const ignorePaths = [".git", "README", "config", ".json"];

const fetch = async (url) => {
  await checkLimitReset();

  const result = await nodeFetch(url, {
    headers: {
      Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN} `,
    },
  });
  return result.json();
};

const githubLinks = {
  rateLimitStatus: "https://api.github.com/rate_limit",
  allPrs: ({ per_page = 100, page, owner, repo }) =>
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&per_page=${per_page}&page=${page}&sort=created&direction=desc`,
  trees: ({ commitID, owner, repo }) =>
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitID}?recursive=true`,
};

const logTimeLeft = (msLeft) => {
  if (msLeft < 0) {
    console.log("Rate limit was Reset!");
  } else {
    console.log(
      new Date(),
      "Rate limit will reset in: ",
      Math.floor(msLeft / 1000 / 60),
      " minutes and",
      Math.floor((msLeft / 1000) % 60),
      "seconds"
    );
  }
};

const waitForReset = (ms) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
};

const writeStatus = (data) => {
  let currentStatus = {};
  try {
    currentStatus = JSON.parse(fs.readFileSync(statusFilePath));
  } catch {}

  fs.writeFileSync(
    statusFilePath,
    JSON.stringify({ ...currentStatus, ...data }),
    "utf8"
  );
};

const writeError = (data) => {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync("errors.json"));
  } catch {}

  fs.writeFileSync(
    "errors.json",
    JSON.stringify({ ...current, ...data }),
    "utf8"
  );
};

const checkLimitReset = async () => {
  const result = await (
    await nodeFetch(githubLinks.rateLimitStatus, {
      headers: {
        Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN} `,
      },
    })
  ).json();

  const { rate } = result || {};

  const resetDate = rate.reset * 1000;
  const now = new Date();
  const msLeft = resetDate - now.getTime();

  console.log("rate.remaining: ", rate.remaining);
  if (rate.remaining === 0 && msLeft > 0) {
    logTimeLeft(msLeft);
    await waitForReset(msLeft);
  }
};

function streamToString(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", (err) => reject(err));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const getFullFileText = async (commitID, path, owner, repo) => {
  const trees = await fetch(githubLinks.trees({ commitID, owner, repo }));

  const tree = trees.tree.find((item) => item.path === path);

  if (!tree) {
    return null;
  }

  const base64Content = await fetch(tree.url);

  return Buffer.from(base64Content.content, "base64").toString();
};

const getFinalBeforeAndAfter = ({ before, after }) => {
  const patch = createTwoFilesPatch(
    "before",
    "after",
    before,
    after,
    "oldHeader",
    "newHeader"
  );

  let finalBefore = "";
  let finalAfter = "";

  const hunks = parsePatch(patch)[0].hunks;

  if (hunks.length > 0) {
    for (const line of hunks[0].lines) {
      const newLine = line.slice(1);
      if (line.charAt(0) === "+") {
        finalAfter += newLine + "\n";
      } else if (line.charAt(0) === "-") {
        finalBefore += newLine + "\n";
      } else {
        finalAfter += newLine + "\n";
        finalBefore += newLine + "\n";
      }
    }
  }

  console.log("finalBefore: ", finalBefore);
  console.log(
    "***************************************************************"
  );
  console.log("finalAfter: ", finalAfter);

  return { before: finalBefore, after: finalAfter };
};

const handleComment = async ({ pr, comment, path, owner, repo }) => {
  const before = await getFullFileText(
    comment.original_commit_id,
    path,
    owner,
    repo
  );

  const after = before
    ? await getFullFileText(comment.commit_id, path, owner, repo)
    : false;

  if (before && after) {
    const final = getFinalBeforeAndAfter({ before, after });

    if (final.before && final.after) {
      const dataset = {
        pr: pr.url,
        comment: comment.url,
        commentText: comment.body,
        filePath: path,
        ...final,
      };

      fs.writeFileSync(
        `datasets/${comment.id}.json`,
        JSON.stringify(dataset),
        "utf8"
      );
    }
  }
};

const checkSetOfPullRequests = async ({
  page,
  lastPrCheckedCreatedAt,
  owner,
  repo,
}) => {
  const allPrs = (await fetch(githubLinks.allPrs({ page, owner, repo }))) || [];

  let prCounter = 1;

  for (const pr of allPrs) {
    console.log("Checking pr number: ", prCounter, " in page: ", page);
    prCounter++;

    if (
      new Date(lastPrCheckedCreatedAt).getTime() <
      new Date(pr.created_at).getTime()
    ) {
      continue;
    }

    if (pr.merged_at) {
      const comments = await fetch(pr.review_comments_url);

      const commentHandlers = [];

      if (comments.length > 0) {
        for (const comment of comments) {
          const path = comment.path;
          let shouldSkip = false;

          ignorePaths.forEach((element) => {
            if (path.includes(element)) {
              shouldSkip = true;
            }
          });

          if (shouldSkip) {
            console.log("shouldSkip: ", path);
            continue;
          }

          commentHandlers.push(
            handleComment({ pr, comment, path, owner, repo })
          );
        }

        await Promise.all(commentHandlers);
      }
    }

    writeStatus({
      [`${owner}/${repo}`]: { lastPrCheckedCreatedAt: pr.created_at },
    });
  }
  if (allPrs.length < 100) {
    return true;
  } else {
    return false;
  }
};

const start = async () => {
  try {
    for (const { owner, repo } of repositories) {
      let page = 1;
      let stopCondition = false;
      let currentStatus = {};
      try {
        currentStatus = JSON.parse(fs.readFileSync(statusFilePath));
      } catch {}

      const lastPrCheckedCreatedAt =
        currentStatus[`${owner}/${repo}`]?.lastPrCheckedCreatedAt ||
        new Date().getTime();

      while (!stopCondition) {
        stopCondition = await checkSetOfPullRequests({
          page,
          lastPrCheckedCreatedAt,
          owner,
          repo,
        });

        page++;
      }
      console.log("Done scraping project", `${owner}/${repo}`);
    }
    process.exit(0);
  } catch (error) {
    console.error("error: ", error.message);
    writeError({ [new Date().toDateString()]: error.message });
    start();
  }
};

start();
