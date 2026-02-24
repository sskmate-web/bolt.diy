import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

export const meta: MetaFunction = () => ([
  { title: 'K-STREET Studio | Bolt' },
  {
    name: 'description',
    content: '브라우저에서 바로 실행되는 AI 개발 스튜디오. 프로젝트 파일을 불러와 분석·수정하고, 명령을 실행해 보세요.',
  },
]);

export const loader = () => {
  const res = json({});
  // Optional: 캐시 전략
  // @ts-ignore
  res.headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  return res;
};

export default function Index() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly
        fallback={
          <div className="flex flex-1 items-center justify-center h-[calc(100vh-80px)] text-bolt-elements-textSecondary">
            <div className="flex items-center gap-2 text-sm">
              <span className="i-svg-spinners:90-ring-with-bg w-4 h-4" />
              <span>Loading studio…</span>
            </div>
          </div>
        }
      >
        {() => <Chat />}
      </ClientOnly>
    </div>
  );
}