const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const INITIAL_PHOTOS = [
  {
    url: 'https://cdn2.thecatapi.com/images/ebv.jpg',
    width: 176,
    height: 540,
  },
  { url: 'https://picsum.photos/seed/horizon/600/800' },
  { url: 'https://picsum.photos/seed/moonlit/600/800' },
];

const feedState = {
  photos: INITIAL_PHOTOS.map(photo => ({
    ...photo,
    likes: 0,
    dislikes: 0,
    comments: [],
    updatedAt: Date.now(),
  })),
};

const MAX_COMMENTS_PER_PHOTO = 80;
const MAX_COMMENT_LENGTH = 240;

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
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT_LENGTH);
}

function getOrCreatePhoto(photoUrl) {
  const existing = feedState.photos.find(photo => photo.url === photoUrl);
  if (existing) return existing;

  const photo = {
    url: photoUrl,
    likes: 0,
    dislikes: 0,
    comments: [],
    updatedAt: Date.now(),
  };
  feedState.photos.push(photo);
  return photo;
}

function addReaction(action, photoUrl) {
  const photo = getOrCreatePhoto(photoUrl || INITIAL_PHOTOS[0].url);
  if (action === 'dislike') {
    photo.dislikes += 1;
  } else {
    photo.likes += 1;
  }
  photo.updatedAt = Date.now();
}

function addComment(text, photoUrl) {
  const cleanText = sanitizeText(text);
  if (!cleanText) {
    throw new Error('Comment text is required.');
  }

  const photo = getOrCreatePhoto(photoUrl || INITIAL_PHOTOS[0].url);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: cleanText,
    photoUrl: photo.url,
    timestamp: new Date().toISOString(),
  };
  photo.comments.push(entry);
  if (photo.comments.length > MAX_COMMENTS_PER_PHOTO) {
    photo.comments.shift();
  }
  photo.updatedAt = Date.now();
}

function getFeed() {
  const photos = [...feedState.photos]
    .map(photo => ({
      ...photo,
      activity: photo.likes + photo.dislikes + photo.comments.length,
      comments: [...photo.comments].slice(-5).reverse(),
    }))
    .sort((a, b) => {
      if (b.activity === a.activity) return b.updatedAt - a.updatedAt;
      return b.activity - a.activity;
    });

  const totals = photos.reduce(
    (acc, photo) => {
      acc.likes += photo.likes;
      acc.dislikes += photo.dislikes;
      acc.comments += photo.comments.length;
      return acc;
    },
    { likes: 0, dislikes: 0, comments: 0 }
  );

  return {
    totals,
    photos,
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
      const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl : INITIAL_PHOTOS[0].url;
      addReaction(action, photoUrl);
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
      const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl : INITIAL_PHOTOS[0].url;
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
