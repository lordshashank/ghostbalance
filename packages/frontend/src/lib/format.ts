export function weiToEth(weiString: string): number {
  try {
    return Number(BigInt(weiString)) / 1e18;
  } catch {
    return 0;
  }
}

export function formatBalance(weiString: string): string {
  const eth = weiToEth(weiString);
  if (eth === 0) return "0 ETH";
  if (eth < 0.01) return "<0.01 ETH";
  if (eth < 1) return `${eth.toFixed(2)} ETH`;
  if (eth < 100) return `${eth.toFixed(1)} ETH`;
  return `${Math.floor(eth).toLocaleString()} ETH`;
}

export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(isoDate).toLocaleDateString();
}

export function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function truncateNullifier(nullifier: string, chars = 8): string {
  if (nullifier.length <= chars * 2 + 2) return nullifier;
  return `${nullifier.slice(0, chars + 2)}...${nullifier.slice(-chars)}`;
}
