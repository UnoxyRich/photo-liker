const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const feedState = {
  likes: [],
  comments: [],
};

const MAX_FEED_ITEMS = 100;
const MAX_COMMENTS = 50;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sanitizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function addLike(action, photoUrl) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    photoUrl,
    timestamp: new Date().toISOString(),
  };
  feedState.likes.push(entry);
  if (feedState.likes.length > MAX_FEED_ITEMS) {
    feedState.likes.shift();
  }
}

function addComment(text, photoUrl) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    photoUrl,
    timestamp: new Date().toISOString(),
  };
  feedState.comments.push(entry);
  if (feedState.comments.length > MAX_COMMENTS) {
    feedState.comments.shift();
  }
}

function getFeed() {
  const likeCount = feedState.likes.filter(item => item.action === 'like').length;
  const dislikeCount = feedState.likes.filter(item => item.action === 'dislike').length;
  const recentComments = [...feedState.comments].reverse().slice(0, 15);

  return {
    likeCount,
    dislikeCount,
    commentCount: feedState.comments.length,
    comments: recentComments,
  };
}

function serveStatic(req, res, parsedUrl) {
  let filePath = parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname.slice(1);
  filePath = path.join(__dirname, filePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=UTF-8',
      '.js': 'application/javascript; charset=UTF-8',
      '.css': 'text/css; charset=UTF-8',
      '.json': 'application/json; charset=UTF-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (parsedUrl.pathname === '/api/like' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const action = body?.action === 'dislike' ? 'dislike' : 'like';
      const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl : '';
      addLike(action, photoUrl);
      sendJson(res, 201, { status: 'ok', feed: getFeed() });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (parsedUrl.pathname === '/api/comment' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const text = sanitizeText(String(body.text || ''));
      if (!text) {
        sendJson(res, 400, { error: 'Comment text is required.' });
        return;
      }
      const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl : '';
      addComment(text, photoUrl);
      sendJson(res, 201, { status: 'ok', feed: getFeed() });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (parsedUrl.pathname === '/api/feed' && req.method === 'GET') {
    sendJson(res, 200, getFeed());
    return;
  }

  serveStatic(req, res, parsedUrl);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Photo Liker server listening on http://localhost:${PORT}`);
  });
}

module.exports = { server, getFeed };
