import { Layout, Typography } from 'antd';
import { HealthCard } from './components/HealthCard';
import { LlmPingCard } from './components/LlmPingCard';

const { Header, Content } = Layout;
const { Title } = Typography;

function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <Title level={4} style={{ color: '#fff', margin: 0 }}>
          Rill · 小说创作 Agent
        </Title>
      </Header>
      <Content style={{ padding: 24, maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <HealthCard />
        <LlmPingCard />
      </Content>
    </Layout>
  );
}

export default App;
