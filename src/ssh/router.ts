import { Router, type Router as RouterType } from 'express';
import { NodeSSH } from 'node-ssh';
import { homedir } from 'node:os';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const sshRouter: RouterType = Router();

// SSH config — supports both key-based and password auth.
// Set LOCK28_PASSWORD in .env to use password auth (fallback when key isn't authorized).
// Set LOCK28_SSH_KEY to override the private key path.
const LOCK28_HOST = { host: '45.55.77.74', username: 'root' };

async function getSSH(host: string): Promise<NodeSSH> {
  if (host !== 'lock28' && host !== 'desktop') {
    throw new Error(`Unknown host: ${host}. Valid hosts: lock28, desktop`);
  }
  const ssh = new NodeSSH();
  if (host === 'lock28') {
    const password = process.env.LOCK28_PASSWORD;
    const keyPath = process.env.LOCK28_SSH_KEY || join(homedir(), '.ssh', 'id_rsa');
    await ssh.connect(password ? { ...LOCK28_HOST, password } : { ...LOCK28_HOST, privateKeyPath: keyPath });
  } else {
    await ssh.connect({ host: '127.0.0.1', username: process.env.USER || process.env.USERNAME || 'root', privateKeyPath: join(homedir(), '.ssh', 'id_rsa') });
  }
  return ssh;
}

function runLocal(command: string, cwd?: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync(command, { shell: true, cwd, encoding: 'utf-8', timeout: 30000 });
  return {
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    code: result.status ?? 0,
  };
}

// POST /api/ssh/command
sshRouter.post('/command', async (req, res) => {
  const { command, host = 'lock28', working_dir } = req.body;
  if (!command) { res.status(400).json({ error: 'command is required' }); return; }
  if (host === 'desktop') {
    const result = runLocal(command, working_dir);
    res.json({ success: true, ...result });
    return;
  }
  let ssh: NodeSSH | null = null;
  try {
    ssh = await getSSH(host);
    const result = await ssh.execCommand(command, { cwd: working_dir || undefined });
    res.json({ success: true, stdout: result.stdout, stderr: result.stderr, code: result.code });
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    ssh?.dispose();
  }
});

// POST /api/ssh/files
sshRouter.post('/files', async (req, res) => {
  const { operation, path: remotePath, content, host = 'lock28' } = req.body;
  if (!operation || !remotePath) { res.status(400).json({ error: 'operation and path are required' }); return; }
  if (host === 'desktop') {
    if (operation === 'read') {
      const data = readFileSync(remotePath, 'utf-8');
      res.json({ success: true, content: data });
    } else if (operation === 'write') {
      writeFileSync(remotePath, content || '');
      res.json({ success: true });
    } else if (operation === 'list') {
      const result = runLocal(`ls -la "${remotePath}"`);
      res.json({ success: true, listing: result.stdout });
    } else {
      res.status(400).json({ error: `Unknown operation: ${operation}` });
    }
    return;
  }
  const tmpFile = join(tmpdir(), `ssh_tmp_${Date.now()}`);
  let ssh: NodeSSH | null = null;
  try {
    ssh = await getSSH(host);
    if (operation === 'read') {
      await ssh.getFile(tmpFile, remotePath);
      res.json({ success: true, content: readFileSync(tmpFile, 'utf-8') });
    } else if (operation === 'write') {
      writeFileSync(tmpFile, content || '');
      await ssh.putFile(tmpFile, remotePath);
      res.json({ success: true });
    } else if (operation === 'list') {
      const result = await ssh.execCommand(`ls -la "${remotePath}"`);
      res.json({ success: true, listing: result.stdout });
    } else {
      res.status(400).json({ error: `Unknown operation: ${operation}` });
    }
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    ssh?.dispose();
    if (existsSync(tmpFile)) try { unlinkSync(tmpFile); } catch {}
  }
});

// POST /api/ssh/service
sshRouter.post('/service', async (req, res) => {
  const { action, service, host = 'lock28' } = req.body;
  if (!action || !service) { res.status(400).json({ error: 'action and service are required' }); return; }
  const COMMANDS: Record<string, string> = {
    start: `systemctl start ${service}`,
    stop: `systemctl stop ${service}`,
    restart: `systemctl restart ${service}`,
    status: `systemctl status ${service}`,
    logs: `journalctl -u ${service} -n 50 --no-pager`,
  };
  const command = COMMANDS[action];
  if (!command) {
    res.status(400).json({ error: `Unknown action: ${action}. Valid: ${Object.keys(COMMANDS).join(', ')}` });
    return;
  }
  if (host === 'desktop') {
    const result = runLocal(command);
    res.json({ success: true, ...result });
    return;
  }
  let ssh: NodeSSH | null = null;
  try {
    ssh = await getSSH(host);
    const result = await ssh.execCommand(command);
    res.json({ success: true, stdout: result.stdout, stderr: result.stderr, code: result.code });
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    ssh?.dispose();
  }
});
