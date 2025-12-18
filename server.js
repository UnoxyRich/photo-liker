const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const CAT_URL = 'https://cataas.com/cat/gif';
const INITIAL_PHOTO_COUNT = 18;

const feedState = {
  photos: [],
};

const MAX_COMMENTS_PER_PHOTO = 80;
const MAX_COMMENT_LENGTH = 240;
const DEFAULT_PAGE_SIZE = 8;

function createPhoto() {
  return {
    id: `cat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    url: CAT_URL,
    likes: 0,
    dislikes: 0,
    comments: [],
    updatedAt: Date.now(),
  };
}

function ensurePhotos(minCount) {
  while (feedState.photos.length < minCount) {
    feedState.photos.push(createPhoto());
  }
}

ensurePhotos(INITIAL_PHOTO_COUNT);

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

function getOrCreatePhoto(photoId) {
  if (!photoId) return feedState.photos[0];
  const existing = feedState.photos.find(photo => photo.id === photoId);
  if (existing) return existing;

  const photo = createPhoto();
  photo.id = photoId;
  feedState.photos.unshift(photo);
  return photo;
}

function addReaction(action, photoId) {
  const photo = getOrCreatePhoto(photoId);
  if (action === 'dislike') {
    photo.dislikes += 1;
  } else {
    photo.likes += 1;
  }
  photo.updatedAt = Date.now();
  return photo;
}

function addComment(text, photoId) {
  const cleanText = sanitizeText(text);
  if (!cleanText) {
    throw new Error('Comment text is required.');
  }

  const photo = getOrCreatePhoto(photoId);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: cleanText,
    photoId: photo.id,
    timestamp: new Date().toISOString(),
  };
  photo.comments.push(entry);
  if (photo.comments.length > MAX_COMMENTS_PER_PHOTO) {
    photo.comments.shift();
  }
  photo.updatedAt = Date.now();
  return photo;
}

function computeTotals(photos = feedState.photos) {
  return photos.reduce(
    (acc, photo) => {
      acc.likes += photo.likes;
      acc.dislikes += photo.dislikes;
      acc.comments += photo.comments.length;
      return acc;
    },
    { likes: 0, dislikes: 0, comments: 0 }
  );
}

function serializePhoto(photo) {
  return {
    ...photo,
    activity: photo.likes + photo.dislikes + photo.comments.length,
    comments: [...photo.comments].slice(-6).reverse(),
  };
}

function getFeed({ cursor = 0, limit = DEFAULT_PAGE_SIZE } = {}) {
  ensurePhotos(cursor + limit + 2);

  const ordered = [...feedState.photos].sort((a, b) => {
    const activityA = a.likes + a.dislikes + a.comments.length;
    const activityB = b.likes + b.dislikes + b.comments.length;
    if (activityB === activityA) return b.updatedAt - a.updatedAt;
    return activityB - activityA;
  });

  const photos = ordered.slice(cursor, cursor + limit).map(serializePhoto);

  return {
    totals: computeTotals(ordered),
    photos,
    nextCursor: cursor + limit,
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
      const photoId = typeof body.photoId === 'string' ? body.photoId : undefined;
      const photo = addReaction(action, photoId);
      sendJson(res, 201, { status: 'ok', photo: serializePhoto(photo), totals: computeTotals() });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (parsedUrl.pathname === '/api/comment' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const text = sanitizeText(String(body.text || ''));
      const photoId = typeof body.photoId === 'string' ? body.photoId : undefined;
      const photo = addComment(text, photoId);
      sendJson(res, 201, { status: 'ok', photo: serializePhoto(photo), totals: computeTotals() });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (parsedUrl.pathname === '/api/feed' && req.method === 'GET') {
    const cursor = Number(parsedUrl.searchParams.get('cursor')) || 0;
    const limit = Number(parsedUrl.searchParams.get('limit')) || DEFAULT_PAGE_SIZE;
    sendJson(res, 200, getFeed({ cursor, limit }));
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
