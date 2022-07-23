import nodeFetch from "node-fetch";
import { createTwoFilesPatch, parsePatch } from "diff";
import fs from "fs";

// const diffs = await nodeFetch(
//   "https://github.com/vercel/next.js/pull/38844.diff"
// );
// console.log("diffs: ", await streamToString(diffs.body));

const OWNER = "vercel";
const REPO = "next.js";

const ignorePaths = [".git", "README", "config", ".json"];

const fetch = async (url) => {
  await checkLimitReset();
  const result = await nodeFetch(url, {
    headers: {
      Authorization: `token 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 `,
    },
  });
  return result.json();
};

const githubLinks = {
  rateLimitStatus: "https://api.github.com/rate_limit",
  allPrs: ({ per_page = 100, page }) =>
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls?state=closed&per_page=${per_page}&page=${page}`,
  trees: ({ commitID }) =>
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${commitID}?recursive=true`,
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

const checkLimitReset = async () => {
  const result = await (
    await nodeFetch(githubLinks.rateLimitStatus, {
      headers: {
        Authorization: `token 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 `,
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

const getFullFileText = async (commitID, path) => {
  const trees = await fetch(githubLinks.trees({ commitID }));

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

const checkSetOfPullRequests = async (page) => {
  const allPrs = (await fetch(githubLinks.allPrs({ page }))) || [];

  let prCounter = 1;
  for (const pr of allPrs) {
    console.log("Checking pr number: ", prCounter, " in page: ", page);
    if (pr.merged_at) {
      const comments = await fetch(pr.review_comments_url);

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

          const before = await getFullFileText(
            comment.original_commit_id,
            path
          );

          const after = before
            ? await getFullFileText(comment.commit_id, path)
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
        }
      }
    }
    prCounter++;
  }
  console.log("allPrs.length: ", allPrs.length);
  if (allPrs.length < 100) {
    return true;
  } else {
    return false;
  }
};

const start = async () => {
  try {
    let page = 1;
    let stopCondition = false;

    while (!stopCondition) {
      stopCondition = await checkSetOfPullRequests(page);
      page++;
    }
    console.log("Done scraping project", `${OWNER}/${REPO}`);
  } catch (error) {
    console.log("error: ", error);
  }
};

start();
