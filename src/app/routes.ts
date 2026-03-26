import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { SearchPage } from './components/SearchPage';
import { WordCardPage } from './components/WordCardPage';
import { NetworkPage } from './components/NetworkPage';
import { WordListPage } from './components/WordListPage';
import { ClassroomPage } from './components/ClassroomPage';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: SearchPage },
      { path: 'word/:cardId', Component: WordCardPage },
      { path: 'network', Component: NetworkPage },
      { path: 'word-list', Component: WordListPage },
      { path: 'classroom', Component: ClassroomPage },
    ],
  },
]);
