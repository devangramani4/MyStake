import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState, LoadingSkeleton } from '../../components/ui/States';
import { userApi } from '../../services/api/accountApi';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setUnread } from '../../store/slices/uiSlice';
import type { Notification, Page } from '../../types';
import { timeAgo } from '../../utils/format';

export default function NotificationsPage() {
  const dispatch = useAppDispatch();
  const unread = useAppSelector((s) => s.ui.unread);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(Page<Notification> & { unread: number }) | null>(null);
  useEffect(() => {
    userApi.notifications(page).then(setData).catch(() => undefined);
  }, [page, unread]);
  const markAll = async () => {
    await userApi.markRead('all');
    dispatch(setUnread(0));
  };
  return (
    <>
      <div className="row between">
        <h1 className="page-title">Notifications</h1>
        {(data?.unread ?? 0) > 0 && <button className="btn btn-secondary btn-sm" onClick={markAll}>Mark all as read</button>}
      </div>
      <section className="card">
        {!data ? <LoadingSkeleton rows={4} /> : !data.items.length ? <EmptyState icon={<Bell size={34} />} title="No notifications" message="Bet settlements, deposits and account updates will appear here." /> : (
          <>
            {data.items.map((n) => (
              <div key={n.id} className="mcard" style={{ display: 'flex', borderLeft: n.readAt ? '3px solid transparent' : '3px solid var(--brand)' }}>
                <div className="row between"><b>{n.title}</b><span className="faint" style={{ fontSize: 12 }}>{timeAgo(n.createdAt)}</span></div>
                <span className="muted" style={{ fontSize: 13 }}>{n.body}</span>
              </div>
            ))}
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
          </>
        )}
      </section>
    </>
  );
}
