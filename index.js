import nodeFetch from "node-fetch";

const fetch = async (url) => {
  const result = await nodeFetch(url, {
    headers: {
      Authorization: `token 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 `,
    },
  });
  return result.json();
};

const githubLinks = {
  rateLimitStatus: "https://api.github.com/rate_limit",
  allPrs: ({ owner, repo, per_page = 100, page }) =>
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&per_page=${per_page}&page=${page}`,
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
  const result = await fetch(githubLinks.rateLimitStatus);
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
// add function
function add(a, b) {
  if (!isNaN(a) && !isNaN(b) && a !== null && b !== null) {
    return a + b;
  } else {
    console.log("Not a number");
  }
}
// multiply function
function multiply(a, b) {
  if (!isNaN(a) && !isNaN(b) && a !== null && b !== null) {
    return a * b;
  } else {
    console.log("Not a number");
  }
}
// division function
function divide(a, b) {
  if (!isNaN(a) && !isNaN(b) && a !== null && b !== null) {
    return a / b;
  } else {
    return "Not a number";
  }
}

const start = async () => {
  try {
    await checkLimitReset();
    let page = 1;

    const allPrs =
      (await fetch(
        githubLinks.allPrs({ owner: "vercel", repo: "next.js", page })
      )) || [];
    console.log("allPrs: ", allPrs.length);
    // const diffs = await nodeFetch(
    //   "https://github.com/vercel/next.js/pull/38844.diff"
    // );
    // console.log("diffs: ", await streamToString(diffs.body));

    for (const pr of allPrs) {
      const comments = await fetch(pr.review_comments_url);
      console.log("comments: ", comments.length);

      if (comments.length > 0) {
        console.log("comments: ", comments);

        // add logic to filter out comments
        // if(comments)
      }
    }

    await checkLimitReset();
  } catch (error) {
    console.log("error: ", error);
  }
};

start();
