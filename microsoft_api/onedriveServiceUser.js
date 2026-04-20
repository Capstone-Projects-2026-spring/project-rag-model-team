import fetch from 'node-fetch';

class OnedriveServiceUser {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseUrl = 'https://graph.microsoft.com/v1.0';
    this.headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  async listFiles(pageSize = 50, folderId = null) {
    try {
      let endpoint = `${this.baseUrl}/me/drive/root/children`;
      
      if (folderId) {
        endpoint = `${this.baseUrl}/me/drive/items/${folderId}/children`;
      }

      const query = `?$filter=file ne null&$orderby=lastModifiedDateTime desc&$top=${pageSize}`;
      
      const response = await fetch(endpoint + query, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.value || [];
    } catch (error) {
      console.error("Error listing files:", error.message);
      throw error;
    }
  }

  async getFile(fileId) {
    try {
      const endpoint = `${this.baseUrl}/me/drive/items/${fileId}/content`;
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.buffer();
    } catch (error) {
      console.error("Error getting file:", error.message);
      throw error;
    }
  }

  async getFileAsText(fileId) {
    try {
      const buffer = await this.getFile(fileId);
      return buffer.toString('utf-8');
    } catch (error) {
      console.error("Error getting file as text:", error.message);
      throw error;
    }
  }

  async getFileAsJSON(fileId) {
    try {
      const text = await this.getFileAsText(fileId);
      return JSON.parse(text);
    } catch (error) {
      console.error("Error parsing file as JSON:", error.message);
      throw error;
    }
  }

  async searchFiles(query, pageSize = 20) {
    try {
      const endpoint = `${this.baseUrl}/me/drive/root/search(q='${query}')`;
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const files = data.value || [];
      return files.filter(f => f.file).slice(0, pageSize);
    } catch (error) {
      console.error("Error searching files:", error.message);
      throw error;
    }
  }

  async getFileMetadata(fileId) {
    try {
      const endpoint = `${this.baseUrl}/me/drive/items/${fileId}`;
      const query = `?$select=id,name,description,file,webUrl,lastModifiedDateTime,size,createdBy`;
      
      const response = await fetch(endpoint + query, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error getting file metadata:", error.message);
      throw error;
    }
  }

  async createFolder(folderName, parentFolderId = null) {
    try {
      let parentPath = `${this.baseUrl}/me/drive/root`;
      if (parentFolderId) {
        parentPath = `${this.baseUrl}/me/drive/items/${parentFolderId}`;
      }

      const endpoint = `${parentPath}/children`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          name: folderName,
          folder: {},
          "@microsoft.graph.conflictBehavior": "rename"
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error creating folder:", error.message);
      throw error;
    }
  }

  async uploadFile(fileName, fileContent, parentFolderId = null) {
    try {
      let parentPath = `${this.baseUrl}/me/drive/root`;
      if (parentFolderId) {
        parentPath = `${this.baseUrl}/me/drive/items/${parentFolderId}`;
      }

      const endpoint = `${parentPath}:/${fileName}:/content`;
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/octet-stream'
        },
        body: fileContent
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error uploading file:", error.message);
      throw error;
    }
  }

  async listJsonFiles() {
    try {
      const files = await this.listFiles(200);
      return files.filter(f => f.name && f.name.endsWith('.json'));
    } catch (error) {
      console.error("Error listing JSON files:", error.message);
      throw error;
    }
  }

  async retrieveFromOneDrive(query) {
    try {
      const files = await this.listJsonFiles();
      
      for (const f of files) {
        try {
          const doc = await this.getFileAsJSON(f.id);
          if (
            doc.name?.toLowerCase().includes(query.toLowerCase()) ||
            doc.id?.toLowerCase().includes(query.toLowerCase())
          ) {
            return {
              ...doc,
              fileId: f.id,
              webUrl: f.webUrl
            };
          }
        } catch (error) {
          console.warn(`Could not parse file ${f.name}:`, error.message);
        }
      }
      
      return null;
    } catch (error) {
      console.error("Error retrieving from OneDrive:", error.message);
      throw error;
    }
  }
}

export default OnedriveServiceUser;
