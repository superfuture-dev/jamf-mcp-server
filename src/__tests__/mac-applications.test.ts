import { describe, expect, it, jest } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { JamfApiClientHybrid } from '../jamf-client-hybrid.js';
import { registerTools } from '../tools/index.js';
import { IJamfApiClient } from '../types/jamf-client.js';

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>;

function registerMacApplicationTools(client: IJamfApiClient): RegisteredHandler[] {
  const handlers: RegisteredHandler[] = [];
  const server = {
    setRequestHandler: (_schema: unknown, handler: RegisteredHandler) => {
      handlers.push(handler);
    },
  } as unknown as Server;

  registerTools(server, client);
  return handlers;
}

describe('Mac App Store applications', () => {
  describe('Classic API client', () => {
    it('reads Mac App Store list and detail response envelopes', async () => {
      const application = { general: { id: '5', name: 'Example Mac App', version: '14.5' } };
      const get = jest.fn()
        .mockResolvedValueOnce({ data: { mac_applications: [{ id: '5', name: 'Example Mac App' }] } })
        .mockResolvedValueOnce({ data: { mac_application: application } });
      const client = Object.create(JamfApiClientHybrid.prototype) as JamfApiClientHybrid;

      Object.defineProperties(client, {
        ensureAuthenticated: { value: jest.fn().mockResolvedValue(undefined) },
        axiosInstance: { value: { get } },
      });

      await expect(client.listMacApplications()).resolves.toEqual([{ id: '5', name: 'Example Mac App' }]);
      await expect(client.getMacApplicationDetails('5')).resolves.toEqual(application);
      expect(get).toHaveBeenNthCalledWith(1, '/JSSResource/macapplications');
      expect(get).toHaveBeenNthCalledWith(2, '/JSSResource/macapplications/id/5');
    });

    it.each(['../policies/id/1', '1/../../policies', '1?subset=General', '0', '-1', '1.0', ''])
      ('rejects invalid Mac application IDs before authentication or network access: %s', async (applicationId) => {
        const ensureAuthenticated = jest.fn();
        const get = jest.fn();
        const client = Object.create(JamfApiClientHybrid.prototype) as JamfApiClientHybrid;

        Object.defineProperties(client, {
          ensureAuthenticated: { value: ensureAuthenticated },
          axiosInstance: { value: { get } },
        });

        await expect(client.getMacApplicationDetails(applicationId))
          .rejects.toThrow('Mac application ID must be a positive integer');
        expect(ensureAuthenticated).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();
      });
  });

  describe('Classic MCP tools', () => {
    it('marks both Mac App Store application tools read-only and non-destructive', async () => {
      const handlers = registerMacApplicationTools({} as IJamfApiClient);
      const response = await handlers[0]() as {
        tools: Array<{ name: string; annotations?: { readOnlyHint: boolean; destructiveHint: boolean } }>;
      };

      for (const name of ['listMacApplications', 'getMacApplicationDetails']) {
        expect(response.tools.find(tool => tool.name === name)?.annotations).toEqual({
          readOnlyHint: true,
          destructiveHint: false,
        });
      }
    });

    it('dispatches list and detail reads through the Classic MCP handlers', async () => {
      const listMacApplications = jest.fn().mockResolvedValue([{ id: '5', name: 'Example Mac App' }]);
      const getMacApplicationDetails = jest.fn()
        .mockResolvedValue({ general: { id: '5', name: 'Example Mac App', version: '14.5' } });
      const handlers = registerMacApplicationTools({
        listMacApplications,
        getMacApplicationDetails,
      } as unknown as IJamfApiClient);

      const listResponse = await handlers[1]({ params: { name: 'listMacApplications', arguments: {} } }) as {
        content: Array<{ text: string }>;
      };
      expect(JSON.parse(listResponse.content[0].text)).toEqual({
        count: 1,
        applications: [{ id: '5', name: 'Example Mac App' }],
      });

      const detailResponse = await handlers[1]({
        params: { name: 'getMacApplicationDetails', arguments: { applicationId: '5' } },
      }) as { content: Array<{ text: string }> };
      expect(JSON.parse(detailResponse.content[0].text)).toEqual({
        general: { id: '5', name: 'Example Mac App', version: '14.5' },
      });
      expect(getMacApplicationDetails).toHaveBeenCalledWith('5');
    });

    it('rejects non-numeric Mac application IDs before invoking the Classic handler client', async () => {
      const getMacApplicationDetails = jest.fn();
      const handlers = registerMacApplicationTools({ getMacApplicationDetails } as unknown as IJamfApiClient);
      const response = await handlers[1]({
        params: {
          name: 'getMacApplicationDetails',
          arguments: { applicationId: '../policies/id/1' },
        },
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Mac application ID must be a positive integer');
      expect(getMacApplicationDetails).not.toHaveBeenCalled();
    });
  });
});
