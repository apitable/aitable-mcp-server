#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from "zod";
import { AitableService } from './aitableService.js';
import type {
  SpaceVO,
  ResponseVO,
  NodeVO,
  GetRecordsResponeDataVO,
  FieldFormatJSONSchema,
  attachmentVO,
  ToolNodeVO
} from "./types.js";


// Create an MCP server
const server = new McpServer({
  name: "AITable MCP Server",
  version: "1.0.0"
}, {
  instructions: "This server provides access to AITable functionalities, allowing you to interact with workspaces, nodes, and records. Use the available tools to list spaces, search nodes, list records, get fields schema, create records, and upload attachments.",
});

const apitableApiKey = process.env.AITABLE_API_KEY;
const apitableBaseUrl = process.env.AITABLE_BASE_URL ?? "https://aitable.ai/fusion";

if (!apitableApiKey) {
  throw new Error("Please set the AITABLE_API_KEY environment variable.");
}

const aitableService = new AitableService(apitableApiKey, apitableBaseUrl);

const formatToolResponse = (data: unknown, isError = false): CallToolResult => {
  return {
    content: [{
      type: 'text',
      mimeType: 'application/json',
      text: JSON.stringify(data),
    }],
    isError,
  };
};

server.tool("list_spaces",
  "Fetches all workspaces that the currently authenticated user has permission to access.",
  async () => {
    try {
      const result: ResponseVO<{ spaces: SpaceVO[] }> = await aitableService.fetchFromAPI("/v1/spaces", {
        method: "GET",
      });

      if (!result.success) {
        console.error("Failed to fetch spaces:", result.message || "Unknown error");
        return formatToolResponse({
          success: false,
          message: result.message || "Failed to fetch spaces"
        }, true);
      }

      return formatToolResponse({
        success: true,
        data: {
          spaces: result.data.spaces,
          definitions: {
            id: "The workspace ID",
            name: "The name of the workspace",
            isAdmin: "Indicates if the user has admin permissions in the workspace"
          }
        }
      });
    }
    catch (error) {
      console.error("Error in list_spaces:", error);
      return formatToolResponse({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error occurred"
      }, true);
    }
  }
);

server.tool("search_nodes",
  "Retrieve nodes based on specific types, permissions, and queries. Nodes in AITable can be of several types: datasheets (also known as sheets, or spreadsheets), form, dashboard, and folders.",
  {
    space_id: z.string().describe('The ID of the workspace to fetch nodes from.'),
    node_type: z.string().describe('Filter the node list to only include nodes of the specified type. Common types include: "Datasheet", "Form", "Automation", "Folder", "Mirror"'),
    query: z.string().optional().describe('A search query to filter nodes by name. If not specified, all nodes will be returned.'),
  },
  async ({ space_id, node_type, query }) => {
    try {
      // Validate the space_id
      if (!space_id || !node_type) {
        throw new Error("space_id and node_type are required.");
      }

      const queryStr = aitableService.buildQueryString({ type: node_type, query });
      const url = `/v2/spaces/${space_id}/nodes${queryStr}`;

      const result: ResponseVO<{ nodes: NodeVO[] }> = await aitableService.fetchFromAPI(url, {
        method: "GET",
      });

      if (!result.success) {
        throw new Error(result.message || "Failed to search nodes");
      }

      const nodes: ToolNodeVO[] = [];

      result.data.nodes.forEach(node => {
        const { id, ...restNodeProps } = node;
        nodes.push({
          ...restNodeProps,
          node_id: id,
        })
      })

      return formatToolResponse({
        success: true,
        data: nodes
      });
    }
    catch (error) {
      console.error("Error in search_nodes:", error);
      return formatToolResponse({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error occurred"
      }, true);
    }
  }
);

server.tool("list_records",
  "Read the records from a specified datasheet with support for pagination, field filtering, and sorting options.",
  {
    node_id: z.string().describe('The ID of the datasheet to fetch records from.'),
    sort: z.array(z.object({
      field: z.string().describe("field name"),
      order: z.enum(["asc", "desc"]).describe("Sorting order, must be 'asc' or 'desc'"),
    })).optional().describe("Sort the returned records."),
    pageNum: z.number().default(1).optional().describe("Specifies the page number of the page, which is used in conjunction with the pageSize parameter."),
    pageSize: z.number().min(1).max(1000).default(20).optional().describe("How many records are returned per page."),
    fields: z.string().optional().describe("The returned record results are limited to the specified fields by name. Multiple fields should be separated by commas without spaces (e.g. 'field1,field2,field3')."),
    viewId: z.string().optional().describe("When the viewId is explicitly specified, all records in the specified view will be returned in turn according to the sorting in the specified view."),
    filterByFormula: z.string().optional().describe("Filter the records by a formula. The formula should be in the format accepted by AITable, this is useful for filtering records based on specific criteria. e.g. '{field1}=\"value1\"' or 'AND({field1}=\"value1\", {field2}=\"value2\")'."),
  },
  async ({ node_id, sort, pageNum, pageSize, fields, viewId }) => {
    try {
      if (!node_id) {
        throw new Error("datasheet ID is required.");
      }

      const queryStr = aitableService.buildQueryString({
        sort, pageNum, pageSize, fields, viewId,
        cellFormat: "string",
        fieldKey: "name",
      });
      const endpoint = `/v1/datasheets/${node_id}/records${queryStr}`;

      const result: ResponseVO<GetRecordsResponeDataVO> = await aitableService.fetchFromAPI(endpoint, {
        method: "GET",
      });

      if (!result.success) {
        throw new Error(result.message || "Failed to list records");
      }

      return formatToolResponse({
        success: true,
        data: result.data
      });
    }
    catch (error) {
      console.error("Error in get_records:", error);
      return formatToolResponse({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error occurred"
      }, true);
    }
  }
);

server.tool("get_fields_schema",
  "Returns the JSON schema of all fields within the specified database, This schema will be sent to LLM to help the AI understand the expected structure of the data.",
  {
    node_id: z.string().describe('The ID of the database to fetch records from.'),
  },
  async ({ node_id }) => {
    try {
      if (!node_id) {
        throw new Error("The datasheet ID (node_id) is required.");
      }
      const result = await aitableService.getDatasheetFieldsSchema(node_id);

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch datasheet fields schema");
      }

      const fieldsSchema: FieldFormatJSONSchema = aitableService.getFieldsJSONSchema(result.data.fields);

      return formatToolResponse({
        success: true,
        data: fieldsSchema
      });
    }
    catch (error) {
      console.error("Error in list_database_fields:", error);
      return formatToolResponse({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error occurred"
      }, true);
    }
  }
);

server.tool("create_record",
  "Create a new record in the datasheet. Extract key information from user-provided text based on a predefined Fields JSON Schema and create a new record in the datasheet as a JSON object.",
  {
    node_id: z.string().describe('The ID of the datasheet where the new record will be created.'),
    fields: z.record(z.any()).describe('A JSON object containing non-Attachment type field data. Keys represent field names and values represent field values. Omit unspecified fields in the API request. The structure of field values must conform to the Fields JSON Schema provided by the "get_fields_schema" tool.'),
    attachments_fields: z.record(z.array(z.object({
      token: z.string(),
      name: z.string(),
      size: z.number(),
      mimeType: z.string(),
      height: z.number().optional(),
      width: z.number().optional(),
      url: z.string(),
    }))).optional().describe('A JSON object containing Attachment type field data. Keys represent field names and values are arrays of attachment objects. The structure of attachment objects must conform to the Fields JSON Schema provided by the "get_fields_schema" tool. You need to use the "upload_file_via_url" tool to obtain the attachment objects.'),
  },
  async ({ node_id, fields, attachments_fields }) => {
    try {
      if (!node_id) {
        throw new Error("The datasheet ID (node_id) is required.");
      }

      if (!fields && !attachments_fields) {
        throw new Error("At least one of 'fields' or 'attachments_fields' must be provided.");
      }


      const getFieldsResult = await aitableService.getDatasheetFieldsSchema(node_id);

      if (!getFieldsResult.success) {
        throw new Error(getFieldsResult.message || "Failed to fetch datasheet fields schema");
      }

      const fieldsSchema = getFieldsResult.data.fields;
      let cells: Record<string, any> = {};
      if (fields !== undefined) {
        cells = aitableService.convertFieldValuesToCellFormat(fieldsSchema, fields);
      }

      if (attachments_fields) {
        console.error("attachments_fields", attachments_fields);
        console.error("fieldsSchema", fieldsSchema);
        fieldsSchema.forEach((fieldschema) => {
          const fieldValue = attachments_fields[fieldschema.name];
          if (fieldValue !== undefined) {
            cells[fieldschema.name] = fieldValue;
          }
        });
      }

      const createRecordResult = await aitableService.createDatasheetRecord(node_id, cells);

      if (!createRecordResult.success) {
        throw new Error(createRecordResult.message || "Failed to create record");
      }

      return formatToolResponse({
        success: true,
        data: {
          records: createRecordResult.data.records,
        },
      });
    }
    catch (error) {
      console.error("Error in create_record:", error);
      return formatToolResponse({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error occurred"
      }, true);
    }
  }
);

server.tool("upload_attachment_via_url",
  "Upload an attachment to the AITable server using its web URL. Returns storage information that can be passed to create_record or update_record tools to associate with a specific records.",
  {
    node_id: z.string().describe('The ID of the datasheet where the attachment will be attached after upload.'),
    attachment_url: z.string().describe('The complete web URL of the file to be uploaded.'),
    attachment_name: z.string().optional().describe('Optional custom name for the attachment after upload.'),
  },
  async ({ node_id, attachment_url, attachment_name }) => {
    try {
      if (!node_id) {
        throw new Error("The datasheet ID (node_id) is required.");
      }

      if (!attachment_url) {
        throw new Error("The attachment URL is required.");
      }

      const result: ResponseVO<attachmentVO[]> = await aitableService.uploadFileToSpace(node_id, attachment_url, attachment_name);

      if (!result.success) {
        throw new Error(result.message || "Failed to upload attachment");
      }

      return formatToolResponse({
        success: true,
        data: result
      });
    }
    catch (error) {
      console.error("Error in upload_attachment_via_url:", error);
      return formatToolResponse({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error occurred"
      }, true);
    }
  }
);

// Start receiving messages on stdin and sending messages on stdout
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Bika MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});